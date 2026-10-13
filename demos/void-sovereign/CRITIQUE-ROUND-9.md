# Critic round 9: 5/10. The game can now hold a battle, but the battle is a radar plot of fighters, and untextured boxes sit in the hero frames

**Method and limits.** A fresh-context art director scored the R9 evidence set
(`.local/shots/R9/evidence/`), the fix-lane exhibits (`R9/fix1-*`, `fix2b-*`) and R8 for
comparison. The scoring follows `CRITIQUE-RUBRIC.md` and the format of round 8. All 41 new
evidence frames were viewed, either full size or on the `_logs/sheets/` contact sheets. Fifteen
were viewed full size. Verdicts that depend on detail were checked on crops made with
`crop.mjs`, which uses headless Chromium only to scale images. The crops are saved to
`.local/shots/R9/critic/` and cited as `critic/…`. I recounted the 50-move totals from
`fix2b-50move.json`, and the frame times and boot times from the 16 `fix1-hitch-*.json` files.
I checked the population-cap code in `src/`. The game was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted and
cannot be fetched. The "pick out the browser one" test was not run, and nothing here is a
side-by-side comparison.

**Evidence limits.**

- **The battle is PLAYED, not staged, for the first time.** The commander is a harness, but the
  game code is unchanged. The frame set comes from run 3 at 15:11 to 15:13, with 55 to 60
  hostiles engaged and 18 to 19 friendlies engaged.
- **No played frame exists of the 88-engaged peak.** It came later, at x4, after the shots.
- **The camera test is still mostly STAGED for big ships.** 9 of 16 capital moves are staged,
  and so are 9 of 11 frigate moves.
- **Stills cannot judge the following:**
  - the 0.2 s alpha fade;
  - pop-in when a rock disappears;
  - the frame pacing of a 60-engaged fight.

| Axis | R7 | R8 | **R9** | Δ | Why |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | The played battle exists, but its frames are glyphs over rock (`R9-played-s13634-run3-wide`) and a nebula with two grey boxes (`-run3-mid`). The best image is a beat flagged as failed. |
| Hull design & silhouette | 5 | 6 | **6** | = | No ship change. The played battle is all small craft: bomber, interceptor and corvette. These are the weakest silhouettes in the roster, and they show at 2 to 5 px. |
| Materials & shading | 6 | 6 | **5** | −1 | Untextured, flat-shaded grey prisms appear in 5 frames (`critic/r9-s2718-fcclose-greybox-3x`, `critic/r9-played-mid-slabs-2x`, `critic/r9-carrier-kill-3x`). Bone at close range now reads as plate (`critic/r9-s13634-fcclose-hull-2x`). |
| Lighting & atmosphere | 6 | 6 | **6** | = | Shadow/lit is below 0.07 on 2 of 8 closes, down from 3 (0.066 and 0.054). Haze barely moves the near rock (s2718: 2.2 to 4.2 against a background of 57.6). There is still no rock between 0.5 and 1.5 km. |
| VFX | 6 | 6 | **6** | = | The freeze is gone. The kill flash grew from 0.04 to 0.15 of the hull area, but it is still a hit-sized starburst on an intact hull (`critic/r9-carrier-kill-3x`). The played battle reads well as trails and tracers. |
| Environment | 6 | 5 | **5** | = | The stipple is gone, but solid rock now sits in front: front40 frames rose from 0 to 7, out-of-frame from 3 to 9 and total40 from 21 to 27. Slab rocks remain (`critic/r9-s2718-fcwide-slab-2x`). |
| UI/HUD | 7 | 7 | **7** | = | The marker layer is the only thing that makes the played battle legible. However, the sovereignty bar (89 against 8) contradicts the fleet count (28 hulls against 89 hostiles). |
| Sense of scale | 5 | 5 | **5** | = | `R9-s13634-first-contact-close` is the first real capital-over-fighters scale image, but it is an accident. The played fight has no frigate or capital in it. The capital close is still a boulder nest. |
| Readability in combat | 6 | 6 | **5** | −1 | Scored on the PLAYED battle, so the STAGED credit ends. You can tell faction from glyph colour. You cannot tell which ship is which, what is shooting what, or what is dying. |
| Cohesion | 5 | 5 | **5** | = | The stipple is gone. Grey placeholder boxes, slab rocks and generic panel bone mean the world is still made from several kits. |
| **Overall** | **5** | **5** | **5** | = | The axis mean is **5.5**, down from 5.7. |

**Overall: 5.** This round fixed two real engineering faults and exposed what the game
actually looks like when it fights. What it shows is not commercial: a field of orange and cyan
glyphs, with hulls too small to see, between walls of rock. **No axis is at 3 or below, so the
blocker rule is not triggered.** The closest criterion is R2, combat legibility under load,
which I would score at 4 in the played battle. The carrier-stall tell from R8 is gone.

## Did the three stuck axes move?

**None of the three moved: art direction, scale and cohesion are all still 5.** This is the
fourth round at 5 for all three. The reason is now clear, because the played battle finally
exists:

- **The real fight does not use the assets that sell the game.** At the run 3 shutter, the
  hostile side was bombers (39), interceptors (14), missile corvettes (17 to 20) and corvettes
  (7). No player frigate or capital was alive.
  - The bone carrier, which is the best asset in the project, is absent from the battle.
  - The close camera had to pick a corvette, because no frigate or capital was engaged within
    2.5 km.
  - A battle of 5 px hooks cannot carry art direction or scale, whatever the shading.
- **Art direction:**
  - `R9-played-s13634-run3-wide` is a tactical plot. About 40 orange glyphs and 15 cyan
    diamonds float over a dark nebula. Rock covers about a third of the frame on the left.
  - At 2x (`critic/r9-played-wide-centre-2x`), the only hulls that read are two player frigates
    and one damaged hostile.
  - `-run3-mid` is fog and glyphs, and its two largest objects are untextured slabs.
  - The strongest image of the round is `R9-s13634-first-contact-close`: a hostile capital's
    ribbed flank fills the left half, with fighters and grey hulls against a ringed planet.
    That is the camera *failing* (it held at 871 m, so the subject is 20 px). A stranger would
    like it, but nobody designed it.
- **Scale:**
  - That same frame proves that the game *can* show scale when a capital sits in the
    foreground.
  - No played frame does. `fix2b-capital-close-s13634-cruiser` still parks three player hulls
    inside boulders as big as they are.
  - The haze evidence is still all at 2.2 to 5.2 km.
- **Cohesion:**
  - Removing the stipple took one alien look out.
  - The grey prisms (`critic/r9-s2718-fcclose-greybox-3x`) add another: a bare
    rectangular box with no panel map, no lights and no drive. It sits beside hulls that do
    have panel maps.
  - At close range, the bone faction now reads as generic grey-beige sci-fi panelling
    (`critic/r9-s13634-fcclose-hull-2x`) rather than bone. That is better than texel mottle,
    but it loses the faction's material identity.

## Readability in combat, judged on the PLAYED battle

This is the first round in which the R2 test can be applied to a real played fight. The
results, frame by frame:

| Question (rubric R2/R3) | run3-wide (15:11) | run3-mid (15:12) | run3-close (15:13) |
|---|---|---|---|
| Who is winning? | **Contradictory.** The glyph count says hostile, by about 40 to 15, and so do HULLS 28 against HOSTILES 89. The sovereignty bar says **YOU 89 / THEM 8**. | Hostile, by glyph count only. | Unanswerable. |
| What is shooting what? | Tracers and missile trails exist (`critic/r9-played-wide-centre-2x`), but their sources and targets are glyphs, not ships. | Two missile trails, with no visible shooter. | Two trails passing a corvette. |
| What is about to die? | One red-bracketed hostile, top right. Nothing else. | Nothing. | The subject reads 100%. Nothing. |
| Can a ship be identified by shape? | No. Hulls are 2 to 5 px under markers. | No. The largest shapes are grey slabs. | Yes. A bone assault corvette with spines and a drive (`critic/r9-played-close-corvette-3x`). |

- **The score is 5.** Faction and the location of the fight read within a second, which
  is the HUD's work. Ship-level reading, threat and health do not read.
- **R2 would be 4, and R3 is still 4.** The R3 score stands because damage still does not
  escalate (`R8-damage-*`, unchanged).
- **The marker layer is doing all the work.** That is legitimate RTS practice, but the
  "close" level of a 60-engaged fight should not be a single corvette 500 m from the hotspot.
- **Run 2 is weaker still.**
  - `R9-played-s13634-mid` shows ten specks crossing a nebula, at 32 engaged.
  - `R9-played-s13634-wide` shows about 15 glyphs beside a rock cluster, while a blotchy
    near-rock owns the right third of the frame.

---

## Per-fix verdicts

### 1. 94e16ed, capital-kill freeze: **VERIFIED. The stall is gone. The kill is still missing.**

| Claim | Verdict | Evidence |
|---|---|---|
| The first capital kill no longer compiles a shader mid-frame | **Verified** | Before the fix, max frame time was 911.2 and 1676.5 ms (carrier, foe), 961.8 (carrier, own), 1584.5 and 2187.2 (cruiser) and 1505.5 (mothership). After it, the 8 runs range from 22.1 to 45.3 ms. The destroyer is an unaffected control: 24.8 and 41.6 ms before. All figures are from `fix1-hitch-*.json`. |
| Max frame time 45 ms or less | **Verified** | The worst after-fix run is mothership/foe at 45.3 ms, which is right at the limit. In the evidence strip, the first frame after the kill comes at +24.3 ms and the gap across the kill is 25.1 ms. |
| Boot cost about 1 s | **Not verified** | The commit itself says +1.3 to 2.6 s. The harness `bootMs` pairs show +0.7 to +5.2 s on the affected classes, but +14.1 s on the unaffected destroyer/own pair. That noise swamps the effect. Harness boot is 25 to 46 s. If any of that is what a player waits through, it is a bigger §5 tell than the freeze was. Measure it cleanly. |
| Residual 101.7 ms hitch (take 1 only) | **Open** | It came at +146 ms, in 1 of 2 takes. With n = 2, "did not reproduce" is not reassuring. The timing fits a second first-use compile, such as smoke, embers or debris. The fix only warms the wreck batch. |
| (Not claimed) the kill frame | **Still weak** | The flash bbox is 0.15 of the hull area, up from 0.04. However, `critic/r9-carrier-kill-3x` shows a white starburst about the size of a hit at the bow, and an intact carrier. The hull is unchanged at +300 ms (`R9-death-carrier-focus-05-k300`). Break-up shows at +8 s. A carrier's death has no primary detonation (rubric P3). |

### 2. 93eda24, rock fade: **PARTIAL. The stipple is gone, but the caps do not hold in what the camera shows.**

| Claim | Verdict | Evidence |
|---|---|---|
| No held partial fades | **Verified** | `heldFrames` is 0. `fix2b-s13634-m2-destroyer-t9` → `t12`: the near rock is solid at t9 and t10, then gone by t12. No R9 frame shows a stipple. |
| A mid-fade rock alpha-blends over 0.2 s | **Not testable from stills** | `blendDrawFrames` is 16, so the twin pass ran. Whether the 0.2 s blend reads as a dissolve or a pop needs video. |
| Rock behind capped at 0.20, total rock at 0.40 | **Contradicted as an outcome** | The recount gives `back20Frames` 27, `total40Frames` 27, `back40Frames` 5 and `front40Frames` 7. The capital group has 7 of 16 moves over 0.40 total. Before a forced move, the capital shot's own lens log reads rock 0.486, front 0.403. The cap is a lens *preference*, not a guarantee. |
| Conceded: out-of-frame 3 → 9 and capital framings | **Confirmed, and worse** | Front-rock frames rose from 0 to 7. In R8, rock was faded; now it stays solid in front until it pops. |
| Worst frame | — | `fix2b-s2718-m9-carrier-t9`: the player carrier, from dead astern, between two rock walls (0.486), behind the tutorial card. Its three round drives read as the digits "888". |

### 3. The played battle (harness fix, no game change): **VERIFIED, with three caveats.**

- **What is verified:**
  - Attack orders: 70, 124 and 224 per run, against 0 in R8.
  - At least 30 engaged was reached in all three runs.
  - The frame set was taken at 55 to 60 engaged, live at x1.
  - The population code is symmetric: `catalog.js:465` (carrier `popProvided: 22`), `:501`
    (Mothership 55) and `ai.js:346-348` (`needRoom = head < 12`). Normal difficulty has
    `yards: 5` (`ai.js:60`).
  - **R8's "design asymmetry" item is withdrawn.** It was the R8 harness never building a
    carrier.
- **Caveat 1: the harness cripples the player side.**
  - It holds itself to 2 carriers while the AI builds 5.
  - The 3:1 late-game production gap is partly self-inflicted, so it is not evidence about
    game balance.
- **Caveat 2: "60 engaged" is 60 *hostiles*.**
  - Friendly engaged was 18. The fight is a swarm against a remnant.
  - No frigate or capital on either side was in it.
- **Caveat 3, flagged by the evidence lane: the sovereignty clock cuts off the climax.**
  - Run 1 ended 4 s after the fight first reached 31 engaged. The player won on points
    while the battle was just starting.
  - In run 3, the hostile sat at 4 to 8 sovereignty for about three minutes, and the match
    ended 33 s after the 88 peak.
  - This is a rubric T2/T3 fault: the climactic assault happens, but the game declares a
    result on a clock rather than on the fight.
  - It is not an art axis, but it decides whether anyone ever sees the battle.

---

## Regressions

1. **Solid rock in front of the subject:** front40 frames rose from 0 to 7, out-of-frame from 3
   to 9 and total40 from 21 to 27 (`fix2b-50move.json`). Removing the stipple traded a
   translucent ghost for a solid one.
2. **Untextured grey prisms.** These are newly identified rather than newly introduced. The R8
   "flat grey ghost rock" in `R8-s13634-first-contact-close` looks like the same object. They
   appear in:
   - `critic/r9-s2718-fcclose-greybox-3x`: a bare box, bottom centre of an otherwise good close;
   - `critic/r9-played-mid-slabs-2x`: two slabs that are the largest shapes in the played mid;
   - `critic/r9-carrier-kill-3x`: two grey sticks beside the carrier;
   - `critic/r9-s13634-fcclose-subject-3x`: two grey hulls in front of the planet;
   - `R9-s2718-first-contact-wide`: a grey stick near the hostile capital.

   None of them matches any hull in `R8-lineup-sheet`, and none has a drive glow. They could be
   an LOD or impostor tier, a projectile mesh, or a missing material. The cause cannot be
   established from stills.
3. **Readability falls from 6 to 5.** The build did not get worse; the STAGED credit ended,
   as R8 said it would.
4. **Still unaddressed from R8:**
   - Damage does not escalate: 20% still reads as 50% (third ask).
   - Hostile capitals still blur into one ribbed slug.
   - Hostile fighters are still thin hooks, and they are now the bulk of every played fight.
   - Slab rocks remain.
   - The Lance Bomber range bug remains.
   - There is still no haze pair at 0.5 to 1.5 km.
   - The capital close is still a boulder nest.

---

## One-line read of each new frame

| Frame | Read |
|---|---|
| `R9-played-s13634-run3-wide` | **The first played battle.** It is a tactical plot: glyphs and tracers over nebula, rock on the left third, two player frigates lower right, and a planet edge. It reads as an RTS, not as a spectacle. |
| `R9-played-s13634-run3-mid` | **Fail.** Fog, scattered glyphs, two missile trails, and two untextured grey slabs as the largest objects. |
| `R9-played-s13634-run3-close` | A bone assault corvette climbing past a ringed planet, with drive lit and two missile trails. Plausible. The "SEAM · THEIRS 63%" label is drawn across its plume. |
| `R9-played-s13634-wide / mid / close` (run 2) | About 15 glyphs beside rocks, with a smeared near-rock on the right; ten specks over nebula; and a player corvette at 150 m with one explosion above it. Thin. |
| `R9-s13634-first-contact-wide` (+`-hazeoff`, `-hud`) | Rock knots and blue dust, with the fleet as specks. Haze lifts the near rock from 2.4 to 6.8 against a background of 12.7. |
| `R9-s13634-first-contact-close` | **Failed beat, best image.** A hostile capital flank fills half the frame against a ringed planet. Read for scale, it is the project's strongest frame. The subject is 20 px. A hard, straight light seam crosses the hull. |
| `R9-s13634-engagement-wide / close` | Rocks, ring and a tracer line; then a frigate at 105 px, firing, but under-lit (0.066). It is a dark stick on blue dust. |
| `R9-s99-first-contact-wide` (+pair, `-hud`) | Planet arc, rocks on the right, and three player hulls large enough to read. Clean. |
| `R9-s99-first-contact-close` | **Best beat.** A bone corvette at 376 px, with spines and drive, beside a dark rock cluster in amber and blue dust. It reads as an alien warship. |
| `R9-s99-engagement-wide / close` | A planet, a chain of hulls and a small fire; then a frigate at 236 px under a hit flash, with rocks and amber dust. Good action. |
| `R9-s2718-first-contact-wide` (+pair, `-hud`) | **Improved on R8.** A hostile capital and a swarm now sit in frame. Rocks still own the right third, one of them a flat slab. A grey stick hull floats near the capital. |
| `R9-s2718-first-contact-close` | Three bone hulls in amber gas, with a capital's drives at the right edge. This would be the best-composed beat, but there is a bare grey box bottom centre, and shadow/lit is 0.054. |
| `R9-s2718-engagement-wide / close` | Specks in amber gas, with 0 engaged; then a player frigate at 116 px with a blue drive, a tracer stream, and a rock on the right. Fine. |
| `R9-s37-first-contact-wide` (+pair, `-hud`) | Violet cloud, grey rock blocks and specks. Haze does nothing here: 44.4 on, 49.1 off. |
| `R9-s37-first-contact-close` | A bone corvette at 102 px against the planet. Tidy and small. |
| `R9-s37-engagement-wide / close` | A tracer cluster in violet cloud; then a player frigate at 254 px on a diagonal with a strong blue plume. Tidy, and empty around it. |
| `R9-death-carrier-focus-00, 01` | The ribbed bone carrier against dust, with grey sticks beside it. A fine creature. |
| `R9-death-carrier-focus-02 to 05` | The kill is a white starburst at the bow (+24 ms), fading by +100 ms. The hull is intact at +300 ms. **No detonation.** |
| `R9-death-carrier-focus-06, 07` | Smoke trails crossing the hull at +1.5 and +4 s. |
| `R9-death-carrier-focus-08` | Ember spray and the hull splitting at +8 s. This is the frame the kill should have been. |
| `R9-death-carrier-focus-09, 10` | A two-piece wreck drifting apart at +12 to +20 s. Good staging, but late. |
| `fix2b-s13634-m2-destroyer-t9 to t13` | A solid blotchy rock owns the lower left, then is gone by t12, leaving a clean player destroyer. No stipple. Solid-then-gone, not faded. |
| `fix2b-capital-close-s13634-cruiser` | Three player hulls embedded in boulders their own size, under a planet. The R8 complaint, unchanged. |
| `fix2b-s2718-m9-carrier-t9` | **Worst frame.** The carrier from astern, between rock walls, behind the tutorial card, with its drives spelling "888". |

---

## Would a stranger believe this is a commercial game?

**No.** This round, though, the reason is different, and it is more fundamental. In ten minutes
of the game playing itself, a stranger now *would* see a battle. That is real progress, and the
freeze no longer files the game as a tech demo on its biggest kill. But they would see:

1. **A battle they cannot see.** 60 engaged hulls are 60 glyphs. The ships under them are 2 to
   5 px fighters. The best assets, the capitals, are not in the fight.
2. **Untextured boxes.** A plain grey prism in a hero close (`R9-s2718-first-contact-close`)
   is the single fastest "placeholder" read a viewer can make.
3. **Rock walls,** now solid instead of stippled (`fix2b-s2718-m9-carrier-t9`).
4. **A match that ends on a clock** just as the fight peaks.
5. **A capital that dies by a spark,** and only breaks up eight seconds later.

`R9-s99-first-contact-close` and `R9-s13634-first-contact-close` show that the art can look
like a game. The played match shows that the game does not yet put that art on screen.
The engineering stays honest:
- the manifest reports its own failures;
- it rejects an end-screen take and keeps it;
- it flags the grey slabs, the 20 px subject and the clock itself.

**5.**

---

## Ranked fixes for round 10

1. **Put frigates and capitals into the played fight, and keep the fight on screen.** This
   touches `src/sim/ai.js` and the end condition. Targets: art direction, scale, readability.
   - The AI's battle groups should commit frigates and capitals, not only small craft.
   - The harness commander must also field and preserve its own.
   - Hold the sovereignty result while a large engagement is live (for example, more than
     20 engaged), or extend the clock, so that the climax resolves by fighting.
   - **Acceptance:** a played frame with at least 30 engaged, at least one frigate or capital
     engaged per side within 2 km of the hotspot, and a close subject of at least 150 px.
2. **Find and remove the untextured grey prisms** (`src/render/`, LOD and impostor tiers,
   `materials.js`). Targets: materials, cohesion, art direction.
   - Name the object first.
   - **Acceptance:** zero untextured shapes across all R10 frames, with a crop of the same
     spot in `R9-s2718-first-contact-close` showing the fix.
3. **Make the rock caps hold in output, not just in lens choice** (`src/core/camera.js`).
   Targets: environment, cohesion, art direction.
   - Fade, or reject the lens, until the settled frame obeys the cap.
   - Fix the slab LOD.
   - Stop parking the capital close in a boulder nest.
   - **Acceptance:** on the 50 moves, front40 0, total40 on no more than 2 moves, back20 on
     no more than 5 frames, and out-of-frame no more than 3.
4. **A capital kill that reads on the kill frame** (`src/fx/`). Targets: VFX, scale (P3).
   - A primary detonation of at least 0.5 of the hull area within 100 ms.
   - Visible break-up within 1.5 s, not 8 s.
   - Warm every first-use death effect at boot, and chase the 101.7 ms hitch.
   - **Acceptance:** 5 takes with no gap over 50 ms from kill −0.1 s to kill +10 s.
5. **Damage that escalates, and a HUD that agrees with itself** (`src/fx/`, `materials.js`,
   HUD). Targets: readability, UI, VFX. This is the third ask.
   - Breaches, fire and venting that step at 50% and 20%.
   - Show fleet strength next to sovereignty, so "89 / 8" cannot be read as winning while you
     are outnumbered 3:1.
   - **Acceptance:** a stranger ranks three frames by health.
6. **Hostile fighters and capitals that read** (`src/ships/bone.js`). Targets: hulls,
   readability. These are now the bulk of every played fight.
   - Thicken the scout, interceptor and bomber so they read at 30 px.
   - Separate the destroyer, cruiser and Mothership by mass and appendage count.
   - Restore a bone surface that is not generic panelling.

**The top round-10 fix is #1.** R9 proved the game can produce a battle. R10 must prove that
the battle shows the ships this project has spent eight rounds designing.

## Evidence required for round 10

- **A played match (no staging)** with wide, mid and close frames taken at 30 or more
  engaged. Include the class mix in frame, frigates and capitals engaged per side, and the
  close subject's H px.
  - If the sovereignty change is made, include the trace showing when the match ended
    relative to the engagement peak.
- **A frame-by-frame census of the grey prisms:** what each one is, and the same frames
  after the fix.
- **The 50-move test** with front40, back20, total40, out and held, committed beside the
  frames. Include at least 15 capital and frigate moves that are *not* staged.
- **A clean boot-time measurement** (first paint to first interactive frame) before and after
  `94e16ed`, 3 takes each.
- **5 carrier kill takes** with frame times from −0.1 s to +10 s, and a crop of the kill frame.
- **The 16 beats** in the same recipe, with the 13634 first-contact close re-shot at 150 m.
  Also keep the 871 m version, labelled as a scale reference.
- **A haze pair with a rock at 0.5 to 1.5 km**, on and off, matched (third ask).
- **Damage at 100%, 50% and 20%,** front-lit, same framing (third ask).
