# Critic round 10: 5/10. The placeholder boxes are gone and the capitals now exist, but nobody photographs them fighting, and the match still ends on a clock

**Method and limits.** A fresh-context art director scored the R10 evidence set
(`.local/shots/R10/evidence/`, 86 kept frames), the fix-lane exhibits (`R10/fix1-*`,
`fix1b-*`, `fix2-*`, `fix3-*`) and R9 for comparison. The scoring follows `CRITIQUE-RUBRIC.md`
and the format of round 9. Every new evidence frame was viewed, either on the `_logs/sheets/`
contact sheets or at full size. Fourteen were viewed at full size. Crops made with `crop.mjs`
are saved to `.local/shots/R10/critic/` and cited as `critic/…`. I read the traces, the boot
table, the five death logs and the fix-lane JSONs for the hold and the fix 2 outcomes. The game
was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted and
cannot be fetched, so nothing here is a side-by-side comparison.

**Evidence limits.**

- **No frame of either played peak exists** (49 and 48 engaged). Played2 set A fired at 31
  engaged, but by the shutter 4.7 s later it was 29 (24 friendly, 5 hostile), with **0
  hostiles in the wide frame**.
- **Only the AI-vs-AI match has frames at 38 to 41 engaged.** It is not staged, but it is not
  played either: the game's own Commander sits in the player chair.
- **No capital is in any frame taken at 30 or more engaged.** At set B, capitals were engaged
  1/1, but none was within 3 km of the hotspot. The hold was never seen in the R10 matches.
- **Stills cannot judge** the 0.2 s rock fade, pop-in, or the pacing of a 50-engaged fight.

| Axis | R8 | R9 | **R10** | Δ | Why |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | The best played image is an ion frigate alone against a planet ring (`R10-AIvsAI-s13634-A-close`). The wides are still glyph plots (`-A-wide`), or glyphs pasted over a flat grey planet (`-B-wide`). Three beat wides are near-empty black (`R10-s37-first-contact-wide`, `R10-s99-first-contact-wide`, `R10-s13634-engagement-wide`). |
| Hull design & silhouette | 6 | 6 | **6** | = | No ship change. At 611 px, the player ion frigate's lower half is a stack of plain extruded blue cylinders (`critic/r10-aiA-close-ion-hull-2x`). The bone carrier remains the project's best asset (`R10-death-carrier-take1-02-kill-crop2x`). |
| Materials & shading | 6 | 5 | **6** | +1 | The grey prisms are gone (census pair, `critic/r10-s2718-fcclose-tophulls-3x`). Near rocks still read as low-poly lumps with smeared noise (`R10-s99-engagement-close`, the lower right of `fix3-mirror2-s13634-hold-hud`). |
| Lighting & atmosphere | 6 | 6 | **6** | = | The haze pair finally has a rock at 688 m. Haze lifts its shadows slightly and cools them (`critic/r10-haze1k-on-rock` against `-off-rock`): real, but faint. Shadow/lit is below 0.07 on 3 of 8 closes (0.036, 0.032, 0.054), up from 2. |
| VFX | 6 | 6 | **5** | −1 | The kill flash **shrank**, from 0.15 of hull area in R9 to 0.04 on 4 of 5 takes (manifest §5). The kill frame is a bow spark on an intact carrier in all 5 takes. Damage at 20% is a few more ember specks than at 50% (`critic/r10-damage-{50,20}-2x`). |
| Environment | 5 | 5 | **6** | +1 | Front rock is fixed in output: front40 0 of 250 frames, and 0.000 rock in front on 7 of 8 closes. The derelicts are real hulls (`fix1b-lodsweep-sheet`). Back20 (10 frames) and out (5 moves) still miss the R9 targets. Close rocks remain low-poly. |
| UI/HUD | 7 | 7 | **7** | = | Sovereignty in %, a BATTLE countdown and an honest end screen are real gains. They are offset by new contradictions: "POPULATION 101 / 77" beside a top bar reading 77 / 77 (`critic/r10-capclose-prodpanel-3x`), and "Hulls lost 262" against "Hulls commissioned 86" (`fix3-mirror2-s13634-end`). |
| Sense of scale | 5 | 5 | **5** | = | No capital is in any ≥30-engaged frame. The 611 px ion frigate is a frigate, and nothing small enough to measure it against is beside it. The moves capital close is a lone cruiser over a rock (`R10-moves-capital-close-s13634-cruiser`). |
| Readability in combat | 6 | 5 | **5** | = | AI-vs-AI A: 37 hulls in frame, all glyphs. Played2: 10 friendlies and 0 hostiles in the wide. The played close subject is an unreadable white streak (`critic/r10-played2-close-subject-4x`). |
| Cohesion | 5 | 5 | **5** | = | The prisms were one foreign kit, and they are gone. Low-poly noise rocks, a flat grey planet (`-B-wide`) and plain blue extrusions on the ion frigate are still three more. |
| **Overall** | **5** | **5** | **5** | = | The axis mean is **5.6**, up from 5.5. |

**Overall: 5.** Two R9 placeholder tells were removed properly: the grey boxes, and solid rock
in front of the subject. The capital-kill freeze stays fixed. But the R9 top fix, capitals in
the fight and the fight on screen, was not met. The capital kill also got *weaker* on the frame
that matters. **No axis and no criterion is at 3 or below, so the blocker rule is not
triggered.** The closest are three criteria at 4:

- **R2, combat legibility:** no frame lets you name three units near death.
- **R3, health at a glance:** 20% still reads as 50%.
- **P3, proportionate destruction:** the carrier dies by spark, and only breaks up later.

## Did the three stuck axes move?

**No. Art direction, scale and cohesion are all 5 for the fifth round running.** Each had a
specific R9 cause, and the round fixed only part of one:

- **Cohesion: one of its three causes is fixed.**
  - The grey prisms are attributed and removed. The derelicts are now charred fleet hulls that
    match the kit (`fix1b-lodsweep-sheet`, the last four rows).
  - The other two causes are untouched: slab rocks and generic panel bone. Near rocks are still
    faceted lumps with stretched noise (`R10-s99-engagement-close`, the bottom third). The
    planet in `-B-wide` is a flat grey ball with a hard band, and it reads as a graphic, not a
    world.
- **Scale: the capitals are in the match but not in the picture.** ed368f6 did put hostile
  destroyers and cruisers into the field: hostile capitals owned rose to 3
  (`_logs/aivsai-s13634-trace.md`, 19:30). Engaged capitals peaked at 1 per side, and no
  capture moment had one in frame. The one image with mass is the 611 px ion frigate, and with
  no fighter beside it, it could as easily be 40 m long as 400 m.
- **Art direction: the composed frames are still accidents, and the system frames are empty.**
  The R10 wides are rock-and-glyph plots (`-A-wide`, `played2-A-wide`) or glyphs over a planet
  (`-B-wide`). Three of the eight beat wides are mostly black with one rock. The best-composed
  frame of the round, `R10-s2718-first-contact-close` (three bone hulls in amber gas with a
  capital's ribbed flank at the edge), is a scripted 168 s beat, not a battle.

## Readability, judged on the played and AI-vs-AI battles

| Question (rubric R2/R3) | played2 A-wide (4:21, 29 eng) | AIvsAI A-wide (10:30, 41 eng) | AIvsAI B-wide (11:52, 43 eng) | AIvsAI A-close (ion frigate) |
|---|---|---|---|---|
| Who is winning? | **Contradictory.** Hulls 34 against 21 hostiles says you. Sovereignty 86% against 100% says them. No hostile is in frame. | The HUD says you (sovereignty 79 against 76, "their sovereignty is draining"). The frame shows orange and cyan glyphs in rough parity. | The HUD says them (80 against 70, "theirs at 65%"). The frame shows glyphs on a planet disc. | Unanswerable. |
| What is shooting what? | Three white streaks, with no visible source or target. | Two muzzle flashes at the centre. Sources are glyphs. | One streak at lower left. | Tracers out of frame. One orange starburst at top right. |
| What is about to die? | Nothing. | Nothing marked. | Nothing. | The subject, at 50%, shows char on the upper hull (`critic/r10-aiA-close-ion-hull-2x`). This is the only health read in the set. |
| Can a ship be identified by shape? | No. Hulls are 3 to 8 px. | Two player hulls at top right, at about 60 px. Everything in the fight is a glyph. | Two grey H-shapes about 40 px across (`critic/r10-aiB-close-Hhull-4x`), probably the two player Lance Bombers listed in frame. They show no drive glow. | Yes: a player ion frigate. |

- **Readability stays at 5.** Faction and the location of the fight read in a second; ship
  identity, threat and health do not. R2 and R3 stay at 4.
- **The class mix explains why.** At the AI-vs-AI A shutter, the 37 hulls in frame were 24
  bombers, 6 missile corvettes, 4 interceptors, 2 corvettes and 1 ion frigate. The game still
  fights with its weakest silhouettes.
- **The played close is the worst close of the round.** The subject is a hostile missile
  corvette at 6% health, 150 m away, and it renders as a white fan of streaks
  (`critic/r10-played2-close-subject-4x`). Its px height was not even recorded.

## Does the played battle now read at capital scale?

**No.** Played2 has 2 friendly frigates and 0 capitals in frame. AI vs AI has 2 frigates
(set A) and 0 (set B), and 0 capitals in either set. The fighters are glyphs, and the frigates
beside them are 20 to 60 px. The 611 px ion frigate is an isolated portrait, not a battle
frame. The data says capitals exist (1/1 engaged at set B), so this is now a **camera and AI-cohesion
problem**, not a roster problem. The capitals fight somewhere other than the hotspot, or they
arrive after it has moved on.

---

## Per-fix verdicts

### 1. 176947f + 62796c7, grey prisms: **VERIFIED for the cause. Matched after-frames for two of the five R9 crops are still missing.**

| Claim | Verdict | Evidence |
|---|---|---|
| The prisms were `env:derelicts` raw-box stacks | **Verified** | The hide-and-diff probe in `fix1-before-death-carrier-prehit-probe.json` and `fix1-before-*-probe.json` flags `env:derelicts` FLAT (instances 7/10/12). It was the only flat-shaded mesh. |
| Derelicts are now charred real hulls | **Verified** | `fix1b-lodsweep-sheet` shows four derelict rows (cruiser, carrier, destroyer, carrier t0) with ribs, spines and panels at L1 to L3, and nothing flat. The 120/120 count matches 30 rows × 4 LODs. |
| The R9 played-mid slabs are gone | **Verified, matched** | `R10-census-played-mid-BEFORE-ec92b4e` reproduces both slabs and a third small object at the same pose. `-AFTER-head` has none. Note that the after frame proves *removal*: no new derelict projects into it, so it shows nothing of the replacement's look. |
| The carrier-kill sticks and the s2718 wide stick are gone | **Verified** | `R10-death-carrier-take1..5-00-prehit` and `R10-s2718-first-contact-wide` show no sticks. |
| The s2718 and s13634 first-contact closes | **Accepted on attribution, not matched** | `R10-s2718-first-contact-close` has no box at bottom centre, and the two hulls at top left are a ribbed bone hull and a dark fleet hull, not boxes (`critic/r10-s2718-fcclose-tophulls-3x`). But it is a different frame. The 13634 close is also a different frame. |
| +6 draw calls | **Plausible** | The beats run at 90 to 136 calls, in line with R9. |

### 2. ed368f6, capitals in the fight: **PARTIAL. The AI builds a line, and the line does not reach the picture.**

| Claim | Verdict | Evidence |
|---|---|---|
| The Mothership builds frigates, then destroyers, then a cruiser | **Verified as an outcome** | Hostile capitals owned go 0, then 1 (11:03), then 2 (15:01), then 3 (19:30) (`aivsai-s13634-trace.md`). |
| Groups wait for capitals | **Not demonstrated** | Max line hulls engaged per side was 7/3 (played) and 3/4 (AI vs AI). Max capitals engaged was 1/1 and 1/3. Commander-vs-AI **never** had 30+ engaged with a capital engaged per side at a capture moment (manifest §1). |
| Difficulty unchanged | **Verified** | `fix2-before-*-critic.json` and `fix2-after-*-critic.json` give winner 1 (hostile) on all 3 seeds in both builds. |
| Determinism holds | **Not checked** | The `fix2-nodeplay-*` files exist. I did not re-derive equality, so this is accepted on the lane's word. |
| R9 acceptance (≥30 engaged, a line hull per side within 2 km, close subject ≥150 px) | **Failed in played. Met only in AI vs AI, by a frigate** | Played2 close: no px recorded, and the subject is unreadable. AIvsAI A: ion frigate at 611 px, with line 2/1 engaged. No capital qualifies. |

### 3. f05d974, the sovereignty hold: **WORKS AS CODED, but does not do the job.**

| Claim | Verdict | Evidence |
|---|---|---|
| The result is held while 20+ are engaged with at least 4 per side, capped at 75 s | **Verified once** | `fix3-mirror2-s13634.json`: the hold started at 1338 s with 25 engaged, peaked at 29 and "settled" after 29 s with 8 engaged. "BATTLE 1:12" is the countdown (74.8 s left at the start). |
| The HUD and the end screen match | **Verified** | The hold frame reads "Sovereignty secured, the battle decides it · 27 engaged". The end screen reads "Battle after the clock ran out 00:29 · 29 engaged at peak". The copy is good. |
| It keeps the climax on screen | **Contradicted** | In all 3 R10 matches, sovereignty hit 0 **395 to 456 s after the peak**, with 11 to 17 engaged. Even in the fix lane's own mirror, the hold began 154 s after that match's 56-engaged peak (`peak.gameS` 1184). The hold catches a skirmish after the battle, not the battle. |
| New, not claimed | **Bug** | The end screen says Hulls lost 262 against Hulls commissioned 86, with 33 remaining. A stranger reads that as broken arithmetic. The cause may be squad members or a counting rule; it cannot be established from stills. The timer also does not say that it counts down. |

### Boot time: **a regression, and a §5 tell in its own right.**

First paint to interactive is 25.73 s on `ec92b4e` and 28.70 s at HEAD: **+2.97 s,
+11.5%**, from 3 cold alternated takes per build (`_logs/boot.jsonl`). This is not a clean A/B
of 94e16ed, because HEAD also carries the derelict batch levels (about +1.7 s by the fix 1
note). The absolute number matters more than the delta: 28.7 s is the rubric §5 "nothing to do
while it loads" tell, and a stranger closes a browser tab long before that.

### Carrier kills: **the frame time is FIXED. The kill is still not one, and the flash is smaller.**

- **Frame time:** the max over 5 takes is **47.3 ms**, at +5.76 s, well after the kill. The
  largest gap across a kill is 31.8 ms, and there are 0 gaps over 50 ms. The R9 acceptance is
  met, and the 101.7 ms R9 residual did not reproduce in 5 takes.
- **The kill frame:** the flash is 0.04 of the hull area on 4 takes and 0.08 on take 1,
  against 0.15 in R9. `R10-death-carrier-take1-02-kill-crop2x` shows a white star at the bow
  tip on an intact carrier. At +300 ms the hull is unchanged (`-05-k300`, all takes).
  Break-up is first seen at +12 s (`-06-plus12s`). The +1.5 s break-up asked for in R9 was not
  attempted.

---

## Regressions

1. **The kill flash shrank** from 0.15 to 0.04 of the hull area (manifest §5 against R9 §1).
   The one P3 frame got smaller.
2. **Boot is +2.97 s**, to 28.7 s.
3. **HUD self-contradiction moved rather than closed.** Population reads 101 / 77 in the
   production panel and 77 / 77 in the top bar (`R10-moves-capital-close-s13634-cruiser`).
   The end screen counts 262 hulls lost from 104 ever owned. In played2, "YOU 86%" sits
   beside "yours at 88%", two unlabelled percentages a stranger will conflate.
4. **Shadow/lit below 0.07 on 3 of 8 closes**, against 2 in R9.
5. **Still unaddressed from R9.** Damage does not escalate (fourth ask): `critic/r10-damage-
   100-2x` and `-50-2x` differ only by fine scorch specks, and `-20-2x` adds a few embers, with
   no fire, breach or venting. Hostile fighters are still thin hooks and the bulk of every
   fight. Close slab rocks remain, and the capital close still parks the ship over a lump.

---

## One-line read per new frame

| Frame | Read |
|---|---|
| `R10-played2-s13634-A-wide` | Cyan glyphs and three white streaks over nebula. A rock pile owns the bottom third. Zero hostiles in frame at "31 engaged". |
| `R10-played2-s13634-A-mid` | Scattered cyan diamonds and three orange glyphs. Rocks frame the top right. No hull larger than 5 px. |
| `R10-played2-s13634-A-close` | **Fail.** The subject is a white streak fan (`critic/r10-played2-close-subject-4x`). Two player frigates at about 40 px with lit drives. Rock pile lower left. |
| `R10-AIvsAI-s13634-A-wide` | The first true mixed fight: about 40 glyphs in two colours, tracers at the centre, a rock wall left and a planet-ring sliver. Two player hulls at top right are the only shapes. A tactical plot. |
| `R10-AIvsAI-s13634-A-mid` | Mostly empty black. A missile trail, a smoke chain, and two player frigates in silhouette. |
| `R10-AIvsAI-s13634-A-close` | **Best played image.** The player ion frigate at 611 px, damaged, drives lit, against a ring and nebula. The lower hull is plain blue cylinders, and a black rock mass sits on the top edge (`critic/r10-aiA-close-topdark-3x`). |
| `R10-AIvsAI-s13634-B-wide` | **Planet as backdrop:** a huge flat grey sphere with a hard band, with glyphs on it. Two grey H-hulls with no drive glow. |
| `R10-AIvsAI-s13634-B-close` | A hostile missile corvette at 102 px with spines, in front of the planet. A missile streak at top left. Tidy, but small. |
| `R10-census-played-mid-BEFORE/AFTER` | A matched pair. The slabs are present, then gone. The after frame is empty nebula. |
| `R10-damage-friendly-100/50/20` | The player destroyer from astern, front-lit, six round drives. **All three look nearly the same.** A stranger could not rank 50 against 20. |
| `R10-death-carrier-take1..5-00/01` | The ribbed bone carrier against blue dust. It is still the project's best creature. |
| `R10-death-carrier-take1..5-02/03/04` | A bow spark, 0.04 to 0.08 of the hull, fading by +100 ms. |
| `R10-death-carrier-take1..5-05-k300` | An intact hull. **No detonation.** |
| `R10-death-carrier-take1..5-06-plus12s` | A two-piece wreck with an ember cloud. This is still the frame the kill should open with. |
| `R10-s13634-first-contact-wide` (+hazeoff, hud) | Three bone hulls small in blue and amber dust. The player has 0 warships at this beat. |
| `R10-s13634-first-contact-close` | Re-shot at 150 m: a bone assault corvette at 144 px between rock clusters. A faceted black slab owns the top right. Competent, not a hero frame. The R9 871 m frame stays labelled as the scale reference. |
| `R10-s13634-engagement-wide / close` | Black with rocks at the edges; then a player assault frigate at 222 px beside a rock cluster with a hull at its edge. Dim. |
| `R10-s99-first-contact-wide` (+pair, hud) | Grey haze, a planet limb with a station corner, and specks. Empty. |
| `R10-s99-first-contact-close` | A bone corvette at 169 px in amber gas, at 21% hull. Readable. |
| `R10-s99-engagement-wide / close` | A rock pile and a planet; then a hostile assault frigate at 183 px over blotchy low-poly rocks (`R10-s99-engagement-close`, the bottom). The rocks are the placeholder read. |
| `R10-s2718-first-contact-wide` (+pair, hud) | A brown dust band, a planet limb, specks, and a red laser line in the HUD take. |
| `R10-s2718-first-contact-close` | **Best beat.** Three bone hulls with drives in amber gas, and a capital's ribbed flank at the right edge. **No box** at bottom centre. |
| `R10-s2718-engagement-wide / close` | A rock frame around specks; then a player frigate at 173 px against a planet edge and teal gas. Good. |
| `R10-s37-first-contact-wide` (+pair, hud) | Nearly black, with one rock and a violet wisp. Empty. |
| `R10-s37-first-contact-close` | Two bone corvettes in black space. Small and isolated. |
| `R10-s37-engagement-wide / close` | Violet gas and specks; then two player frigates, at 132 px, one cropped at the bottom edge. Clean, and empty. |
| `R10-s2718-haze-rock1k` / `-hazeoff` | The rock at 688 m is slightly lifted and cooled with haze on. The effect works, but at about the strength of a grading tweak. |
| `R10-moves-capital-close-s13634-cruiser` | A player cruiser in profile, slab-sided and convincing, over a faceted rock lump. **HUD: POPULATION 101 / 77.** |
| `R10-moves-s99-m6-cruiser-t11` | A player cruiser, clipped at the edge. The strongest hull detail of the moves set. |
| `R10-moves2-s37-m0/m6/m8/m11` | An assault frigate lost between rocks; an ion frigate against the planet; a hostile Mothership with escorts (a real size read); and a collector filling the top right with its ribs cut off. |
| `fix3-mirror2-s13634-hold-hud` | The hold HUD is clear. The frame is one bone hull and a dagger, with near-plane black slab rocks at the bottom right. "27 engaged" is not visible. |
| `fix3-mirror2-s13634-end` | Good copy ("the result waited for the fight"), with impossible hull arithmetic. |

---

## Would a stranger believe this is a commercial game?

**No.** The reasons are fewer than in R9, and that is real progress: the grey boxes are gone,
rock no longer walls off the subject, the capital kill no longer hitches, and the end screen
explains itself. A stranger watching the match would still see:

1. **A 29-second load** to the first interactive frame.
2. **A battle drawn as glyphs.** The fight that peaks at 48 to 53 engaged is bombers and
   corvettes at 3 to 8 px. The frigates and capitals that sell the game are elsewhere, or
   arrive late.
3. **A carrier that dies by a spark**, now a smaller one, and breaks up some seconds later.
4. **A match decided 7 minutes after its climax**, on a clock, in a skirmish of 11 to 17
   ships.
5. **Numbers that contradict each other:** 101 / 77 population, and 262 hulls lost from 104.
6. **Close rocks** that look like low-poly lumps with stretched noise.

`R10-s2718-first-contact-close` and `R10-AIvsAI-s13634-A-close` show the art can look like a
game. The match still does not stage that art where the fighting is. **5.**

---

## Ranked fixes for round 11

1. **Make the big fight happen where, and when, the capitals are.** Targets: scale, art
   direction, readability. This touches `src/sim/ai.js` and the end condition.
   - The AI's attack groups must include their line hulls *at contact*, not later. Gate the
     launch on the capitals being within about 1.5 km of the group's centroid.
   - Make the sovereignty drain *pause* while 20 or more are engaged anywhere, instead of
     holding the result after it hits zero. The clock should not run down during the battle it
     is meant to wait for.
   - **Acceptance:** a played frame at 30 or more engaged with a capital engaged per side
     within 2 km of the hotspot, a capital ≥150 px in the close, and match end within 120 s of
     the last ≥30 poll.
2. **A capital kill that reads on the kill frame.** Targets: VFX, scale (P3). This touches
   `src/fx/`.
   - A primary detonation of at least 0.5 of the hull area within 100 ms. The hull should
     split or visibly break within 1.5 s, not 12 s.
   - Keep the 5-take frame-time log.
   - **Acceptance:** flash ≥0.5 on 5/5 takes, a hull change visible at +300 ms, and no gap
     over 50 ms.
3. **Damage that escalates: fire, breaches and venting at 50% and 20%.** Targets:
   readability, VFX, materials. This touches `src/fx/` and `materials.js`. **This is the fifth
   ask.**
   - **Acceptance:** a stranger correctly ranks the three damage frames.
4. **Fix the HUD arithmetic.** Targets: UI, readability. This touches the HUD and
   end-screen stats.
   - Population must agree between the panel and the top bar. If 101 counts queued
     population, label it as queued.
   - "Hulls lost" must count the same units as "commissioned".
   - Label the seam % against the sovereignty %, and mark the BATTLE timer as a countdown.
   - **Acceptance:** no two numbers on any one frame contradict each other.
5. **Near-rock surface and silhouette.** Targets: environment, cohesion, materials. This
   touches the asteroid generator and the LOD.
   - Rocks within 1 km need more subdivision and a material that does not stretch noise
     across facets (`R10-s99-engagement-close`).
   - Retire the slab LOD.
   - **Acceptance:** crops of 3 close rocks at 2x show no visible facets or stretched texture.
6. **Fighter silhouettes and boot time.** Targets: hulls, readability, and the §5 browser
   trap.
   - Thicken the hostile bomber, interceptor and missile corvette to read at 30 px. They are
     24 of the 37 hulls in the best battle frame.
   - Get first paint to interactive under 15 s, or put something worth watching on the boot
     screen.

**The top round-11 fix is #1.** R10 proved that the capitals exist and that the hold works on
paper. R11 must prove that both arrive at the same moment as the battle.

## Evidence required for round 11

- **A played commander-vs-AI match**, with wide, mid and close frames taken **at the peak**
  (within 30 s of the max engaged poll). For each frame, give the class mix in frame, the
  capitals in frame per side, and the close subject's px H.
  - Include the trace showing peak time, hold start and match end.
- **The hold, in a played match,** with the frame, the HUD and the end screen, and the
  peak-to-end gap.
- **5 carrier kills**, with the kill crop at 2x, the frame times from −0.1 to +10 s, and the
  flash area. Add one destroyer and one cruiser kill for the P3 time ratio.
- **Damage at 100%, 50% and 20%**, in the same framing, plus a three-frame ranking by
  someone who has not seen the numbers.
- **One HUD frame per number fix:** population, hulls lost, and the sovereignty % against
  the seam %.
- **Three close-rock crops** at 2x, before and after.
- **Boot:** 3 cold takes at HEAD, with a frame of the boot screen at 10 s.
- **The 50-move test**, including seed 2718 (re-run before the match ends), with at least
  15 played frigate and capital moves.
