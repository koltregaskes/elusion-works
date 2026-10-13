# Critic round 5: 5/10. The wrecks stay, the camera mostly behaves, and the engines now draw lines across the screen

**Method and limits, stated first.** A fresh-context art director scored the 80 R5
evidence files against `CRITIQUE-RUBRIC.md` and `ARCHITECTURE.md` §3, using round 4's
frames (`.local/shots/R4/evidence/`) for comparison. **No blind A/B against Homeworld
was performed.** The reference stills are copyrighted and cannot be fetched, so the
§4 "pick out the browser one" test was **not** run, and nothing here is a
side-by-side. Every claim about a detail under about 60 px was checked at 2–8× with
nearest-neighbour magnification. Brightness and size claims were checked by sampling
pixels with PIL. Crops are in `.local/shots/R5/critic/` and are cited as `critic/…`.
The developers' `fix1-*` to `fix6-*` pairs were treated as their own exhibits, used
only where no neutral frame exists, and marked **(dev exhibit)**. The game was not
run.

**Evidence limits.**

- **FX run on the wall clock.** Combat frames were shot live at ×1, so FX density
  is honest.
- **The fleet battle is staged** (64/77 at the shutter, 31 engaged). The played
  match was lost on sovereignty at 10:38 and never had more than 17 hostiles
  engaged.
- **Engine plumes at cruise were not captured.** The hull was off-frame (MANIFEST
  §9), so round 4's plume request is still open. The plume figures below come from
  the beat frames.
- **Flicker and taper cannot be judged from stills.**

| Axis | R3 | R4 | **R5** | Δ |
|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = (best frame yet; a fully black frame in the set) |
| Hull design & silhouette | 5 | 5 | **5** | = (no model work this round) |
| Materials & shading | 5 | 5 | **5** | = (wrecks char; damage is now a full-body leopard print) |
| Lighting & atmosphere | 5 | 5 | **6** | +1 (5 of 6 measured subjects hold the contract in play) |
| VFX | 5 | 4 | **5** | +1 (hull survives death; plumes and impacts still fail) |
| Environment | 6 | 6 | **6** | = (rocks better; nebula contours remain) |
| UI/HUD | 7 | 7 | **7** | = (world layer quiet; panel clipped, red mark oversized) |
| Sense of scale | 5 | 5 | **5** | = |
| Readability in combat | 5 | 6 | **6** | = (staged only; the played match never gets there) |
| Cohesion | 5 | 5 | **5** | = |

**Overall: 5.** The mean is 5.5, up from 5.3. **No axis is at ≤3**, so the blocker
rule is not triggered, and VFX has stepped back from the edge.

Round 5 fixed the worst of round 4. A capital no longer vanishes: it breaks, chars and
drifts for at least 25 s. The seed-99 rock clip is gone, the seam rings have stopped
dominating the frame, and in-play hulls finally have a shadow side. But the same
evidence shows a frame that is **entirely black** because the camera is inside a rock,
engine plumes **3.5× hull length** in three of the six close frames, a **hexagon
shield bubble** that the developers say no longer exists, and damage that covers
a hull at 50% like leopard print. The ceiling went up. The floor did not.

---

## Per-fix verdicts

### Fix 1 (2e15ad8), deaths: **PARTIAL. Capitals are fixed; small-ship flashes are not.**

- **The hull survives the kill: VERIFIED.** In `R5-death-cruiser-focus-06` (kill
  +6.0 s) the cruiser is in three charred sections with an orange glow in the
  breaks. `-07` (kill +10.0 s) passes round 4's acceptance test, and in `-10`
  (kill +25.3 s) two sections are still in frame. The carrier strip matches: three
  or four sections from `-07` to `-10`.
- **Secondary detonations: VERIFIED.** There are small flashes along the hull in
  cruiser `-03` and `-04` and carrier `-03` to `-05`, followed by soot columns.
- **The ring-with-spokes is gone, and rings are within the 2× cap: VERIFIED.**
  - The cruiser ring is a thin, smooth ellipse about 730 px wide around about
    600 px of wreck (`R5-death-cruiser-focus-06`), or about 1.2×.
  - The carrier ring measures 598×656 px of bright pixels against about 560 px of
    wreck (`R5-death-carrier-focus-06`, thresholded), or about 1.1–1.2×.
- **But the carrier ring reads as a soap bubble popping.** It is a thick, glowing,
  wobbly-edged circle filled with radial speed lines, like an anime impact frame.
  The debris is amber cardboard: flat, blocky chunks lit orange (same frame).
- **The 1.2× flash cap: NOT VERIFIED on the interceptor.**
  - The hull is about 510 px across (`R5-death-interceptor-focus-01`; the focus
    camera sits at 30 m).
  - The kill flash's bright orange core thresholds to **694×604 px**, or 1.36×,
    and its faint spikes reach about 1000 px, or about 2× (`-03`).
  - In `-04`, a horizontal lens-flare streak is **870 px**, or 1.7×.
  - Round 4's acceptance line was "no interceptor flash larger than the
    interceptor". It fails. The cartoon sun is gone, but a lens-flare firework has
    taken its place.
- **The capital hit flash** is inside the cap (cruiser-01: bright core 396×308 px
  against a 575 px hull). It is wrapped in a hex bubble, though; see fix 4.

### Fix 2 (42448b4), camera: **PARTIAL. 17/20, and one failure is a black frame.**

- **Seed 99 is clean,** 10 of 10 (`R5-nearplane-s99-m9-t12`, `-t13`), and round 4's
  seed-99 rock clip is gone from `R5-s99-first-contact-close`.
- **Seed 13634 fails 3 of 10.** `R5-nearplane-s13634-m2-t12` is **100% interior
  fill**: an empty black frame under the HUD, with one grey sliver at the top. A
  stranger who saw it would assume the game had crashed.
- **The developers' 20/20 is not reproduced.** The manifest says their pass was
  shot under the tutorial card and that the result depends on where ships happen to
  sit against rocks. A camera fix that passes or fails by fleet position is not a
  fix.
- **A framing fault not covered by the metric.** In
  `R5-s13634-first-contact-close` the subject, an Assault Corvette, is a **6 px**
  red mark. A hostile capital's stern crosses between camera and subject, cut off
  by the top of the frame, and its plume runs across the planet
  (`critic/fcc13-plume.png`).

### Fix 3 (f6496ed), lighting in play: **VERIFIED on hulls in focus; rocks 2 of 3; the developers' number is not reproduced.**

- **Hulls hold, by the manifest's mask method.**
  - Hostile Assault Frigate: **0.099** (`R5-s13634-engagement-close`).
  - Player Ion Frigate: **0.136** (`R5-s99-engagement-close`).
  - Hostile Missile Corvette: **0.151**, borderline, from a contaminated pair.
  - `critic/ec13-hull-3x.png` shows a real dark flank and a lit edge. That is the
    first in-play hull in four rounds with a terminator.
- **The developers claimed 0.06. The neutral lane measured 0.099** on the same
  seed and beat. It holds, but not by the margin claimed.
- **Rocks: 2 of 3.** Seed 99 measures 0.051 and seed 2718 measures 0.081. **Seed
  13634 fails at 0.306.** Its big right-hand rock in `R5-s13634-engagement-wide`
  samples **51** on both its "lit" face and its far face; it is the same clay rock
  round 4 flagged.
- **Out of focus, hulls are still front-lit.**
  - **Mothership:** in `R5-tutorial-dismiss-before` and `-after`, the top deck,
    side wall and tower faces are all lit, with no terminator across a 900 px hull.
  - **Player Destroyer:** in `R5-s2718-engagement-close` (`critic/ec2718-hull-3x.png`),
    the top face samples 90 and the lower face 22, so the shadow face is about 24%.
    It reads as a pale model under studio light.
- **The flagged risk,** a dark flank lost against the night side, is **not observed**
  in this set. The damaged destroyer silhouettes cleanly against the lit limb
  (`R5-damaged-friendly-50-focus`).

### Fix 4 (1b511a0), combat FX: **PARTIAL. One claim verified, two partial, three contradicted.**

| Claim | Verdict | Evidence |
|---|---|---|
| Impacts at range 6.5–8 px | **Partial** | At the wide recipe they hold: **8×7 px** (`R5-s13634-first-contact-wide`, at 750,425). At fleet distance they do not. The saturated cores are **25×24 and 36×38 px** (`R5-fleet-staged-close`), and they merge into a **64×60 px** cloud (`R5-fleet-staged-wide`). They are round bloom discs, not stars (`critic/fsc-impacts-4x.png`, `critic/fsw-impacts-4x.png`). The cap holds only where nobody is looking. |
| Beams: core, shell, flicker, taper | **Partial** | There is now a white core inside an orange shell (`critic/fsc-beams-3x.png`, 3×). Width is constant over about 400 px. Flicker and taper cannot be judged from stills. |
| Bomber fire is a bead | **Not verified** | `R5-s99-first-contact-close` has the same orange shaft round 4 flagged at the same beat: about **500 px** long, roughly 3× the bomber's length, leaving the bomber's stern and ending in an impact star (`critic/fcc99-bomber-shaft.png`, 2×). Whether it is fire or a plume, it is a shaft, not a bead. |
| Shield hit is a smooth local patch | **Contradicted** | The first hit on both capitals is a **hexagon-tiled bubble** about 600 px across, over half the hull (`R5-death-cruiser-focus-01`, `R5-death-carrier-focus-01`). This is the faceted bubble the commit says was removed. |
| Plume cap 0.35× hull | **Contradicted** | **Friendly interceptor:** about 410 px of plume behind a hull of about 120 px, or **3.4×** (`critic/fcc99-cyan-plumes.png`). **Hostile Missile Corvette:** about 830 px of plume behind a 230 px hull, or **3.6×** (`R5-s2718-first-contact-close`, `critic/fcc2718-plumes.png`). **Hostile capital in `R5-s13634-first-contact-close`:** the plume is ≥1.4× the visible hull. **`R5-nearplane-s99-m9-t13`:** a cyan streak crosses the whole frame. Round 4 measured 1.15×; this is worse. |
| Impostor contrast floor (not done) | **Confirmed not done** | Distant hulls render as flat grey slabs with no shading: `R5-s99-engagement-close` (`critic/ec99-slabs-4x.png`), `R5-s13634-first-contact-close` and `R5-death-cruiser-focus-10`. They read as untextured placeholder boxes. |

### Fix 5 (9394f8e), HUD world layer: **VERIFIED, with three faults.**

- **The seam rings are quiet: VERIFIED.** In `critic/fcw13-seams.png` the ring is a
  faint bone dashed hairline with a short cyan arc of about 80 px for *yours*, and
  the labels are dim. The rings no longer own any wide frame in the set. Round 4's
  heaviest HUD complaint is closed.
- **Tutorial Dismiss: VERIFIED.** The card is up in `R5-tutorial-dismiss-before`
  and gone in `-after`, 1.0 s after a real click. The card is now backed.
- **The production panel is backed and shows class names: VERIFIED** in every beat
  frame.
- **Red at below a third: VERIFIED, but oversized.** At fleet range the mark is a
  **filled** red diamond of about 22 px on a 65 px hull, covering its middle third
  (`R5-damaged-friendly-20-fleet`). The legend says a red *outline* means below a
  third, and *filled* means about to die. The frame shows neither cleanly.
- **Fault: the keys panel's bottom row is clipped: VERIFIED.** "Two-finger drag /
  Pan" is cut through its middle at the frame edge (`R5-keys-panel`,
  `critic/keys-bottom-clip-3x.png`). The legend itself is present and readable.
- **Fault: seam labels still print over the backdrop.** "SEAM · YOURS 49%" sits on
  the planet's lit limb in `R5-s2718-first-contact-close`.

### Fix 6 (60c0646), nebula: **PARTIAL. The worm maze is gone; the contour bands remain.**

- **The dim sky is softer (dev exhibit).** `fix6-after-s99-sky-b-crop` has lost the
  fine worm lines of `fix6-before-s99-sky-b-crop`, but it is still ropey.
- **The bright ironmoth regions still band: VERIFIED.**
  - `R5-s99-first-contact-close` (`critic/fcc99-bomber-shaft.png`) shows dark
    contour loops behind the fight, like fingerprints.
  - In `R5-s99-first-contact-wide` (`critic/fcw99-nebula.png`) the bright mass
    covers roughly 40% of the frame, against a 30% cap. It has hard-edged black
    "holes" and contour lines.
  - It is a clear improvement on R4's brain coral (`critic/r4-vs-r5-s99-fc.png`),
    but it is not dust.
- **Emberfall bands like wood grain: VERIFIED.** `R5-s2718-first-contact-wide`
  (`critic/fcw2718-nebula.png`) and `R5-s2718-engagement-close` show dark veins
  following every density edge. In `R5-s2718-engagement-wide`, two glowing amber
  blobs side by side read as **a pair of eyes in a face**.

### Evidence-lane flags, checked

1. **Damage cracks cover the whole hull uniformly: VERIFIED.** At 50%, the
   destroyer in `R5-damaged-friendly-50-focus` is already covered nose to tail in
   peach squiggles. At 20% (`critic/df20-cracks-3x.png`) it is solid leopard print,
   at the same density on turrets, bridge and hull. All 13 hits came from the camera
   side, and nothing in the pattern shows it. At fleet range (`-50-fleet`) the damage
   does not read at all. Wrecks use the same speckle (`R5-fleet-staged-close`,
   `critic/fsc-beams-3x.png`).
2. **Keys panel bottom row clipped:** see fix 5.
3. **WebGL context loss on seed 2718: a robustness risk,** with the cause not
   judgeable from frames. Two of three boots failed, one with a shader
   VALIDATE_STATUS error. The page degraded to a message rather than crashing,
   which is the minimum. Losing the context on a third of the boots of one seed
   would get the game filed under "browser demo".
4. **Seed 13634 opens with 1 player warship (R4 had 17): VERIFIED from the HUD.**
   `R5-s13634-first-contact-wide` shows "10 / 55", 1,305 RU unspent and one
   interceptor selected. The first-contact beat is now a lone interceptor against
   8 bombers, which is not a fight. The cause is unknown.
5. **The played match never reaches a fleet battle: VERIFIED from the manifest.**
   The only frames in which ships fight as fleets are staged.

---

## Regressions found

1. **Engine plumes have grown from 1.15× (R4) to 3.4–3.6× hull length,** and in
   close frames they are now the longest lines on screen (fix 4). They read as
   tracer fire or tow cables, not engines.
2. **A hexagon shield bubble appears on capital hits** (cruiser-01, carrier-01). It
   was not visible in R4's death strips, and the commit claims to have removed it.
   It is the most dated-looking effect in the set.
3. **Damage now reads, but as a pattern.** In R4 a cruiser at 48% looked intact. In
   R5 a destroyer at 50% looks like a different, camouflaged ship.
4. **The seed-13634 opening economy has changed:** 1 warship at first contact
   against 17. This needs an explanation before more beats are compared across
   rounds.
5. **Robustness:** the WebGL context was lost on 2 of 3 boots of seed 2718.
6. **Still unaddressed from R4:**
   - floating geometry and the palette-swap hostile faction (no model work);
   - texel speckle on hull detail (`critic/ec13-hull-3x.png`, white pixel blocks
     mid-hull);
   - the title art in a different style from the game;
   - no Mothership on the briefing.

---

## One-line read of every frame

| Frame | Read |
|---|---|
| `R5-s13634-first-contact-wide` | Quiet rings at last; a rust-striped hostile capital, built like a brick, owns the right half; the "fight" is eight glyphs and one interceptor. |
| `R5-s13634-first-contact-close` | **Failed framing.** The subject is a 6 px mark; a cut-off capital and its 1.4× plume cross a flat-lit gas giant; two grey slab impostors. |
| `R5-s13634-engagement-wide` | Lumpy clay rocks frame a cyan glyph swarm; one hostile capital is the only ship you can see. |
| `R5-s13634-engagement-close` | **Good.** A dark hull with a real terminator against the nebula; let down by a white bloom blob at the bottom edge and texel specks. |
| `R5-s99-first-contact-wide` | The ringed giant is a fine backdrop; a grey marbled nebula with black holes takes 40% of the frame; the fleet is glyphs. |
| `R5-s99-first-contact-close` | The most cinematic beat frame, and the most broken one: a 500 px orange shaft, 3.4× cyan plumes, urchin-spike hits and fingerprint nebula. |
| `R5-s99-engagement-wide` | Two rocks, one a cauliflower and one a noise-texture slab; a white bloom blob of 25×35 px at the fight; the cyan seam arc is fine. |
| `R5-s99-engagement-close` | The ion frigate is a bow-on 60 px knot in front of the giant; three flat grey slabs float beside it. R4's best frame is no longer best. |
| `R5-s2718-first-contact-wide` | Emberfall works for colour: sepia dust and well-lit brown rocks. The dust is grained like wood, and there are no ships, only glyphs. |
| `R5-s2718-first-contact-close` | Two hostile missile corvettes, toasters on surfboards, trail orange plumes 3.6× their length across the frame. |
| `R5-s2718-engagement-wide` | No ships visible at all; wood-grain nebula; two amber blobs read as eyes. |
| `R5-s2718-engagement-close` | The player destroyer, the best hull, reads pale and studio-lit against wood-grain dust. |
| `R5-damaged-friendly-50-focus` | The destroyer silhouettes well against the lit limb, but at 50% it is already covered in peach squiggles. |
| `R5-damaged-friendly-20-focus` | Solid leopard print over every surface, and a filled red diamond on the hull. |
| `R5-damaged-friendly-50-fleet` / `-20-fleet` | At 65 px the damage is invisible; at 20% the red diamond covers a third of the ship. The giant's lit side is a flat white disc (samples 173). |
| `R5-death-interceptor-focus-strip` (`-00` to `-10`) | Blotch-camo paper plane, then a blurred tan X, then an orange lens-flare firework 1.4–2× the ship, then a 1.7× streak, then nothing by +0.8 s. Faster and smaller than R4, but still a firework. |
| `R5-death-cruiser-focus-strip`, `-00` to `-02` | A credible dark capital; hit 1 is a hexagon shield bubble over half the hull; no visible change at 1/8. |
| `R5-death-cruiser-focus-03` to `-05` | Secondary flashes along the hull, then soot columns. **The hull is still there.** |
| `R5-death-cruiser-focus-06` | Three charred sections, glowing breaks, a thin ring at 1.2×, amber cardboard debris. The best death frame this project has shown. |
| `R5-death-cruiser-focus-07` to `-10` | Sections drift and tumble out of frame with embers; still visible at +25 s, in the same leopard speckle. |
| `R5-death-carrier-focus-strip` (`-00` to `-10`) | The same arc: hex bubble, breakup, soot, then a glowing soap-bubble ring with speed lines at +6 s, and three or four sections at +25 s. |
| `R5-death-cruiser-wide-strip` (`-00` to `-10`) | At 5200 m the ship is a smudge; the ring at +6 s is the only legible event; the wreck is a few specks. Honest for the distance. |
| `R5-nearplane-s13634-m2-t12` | **Broken.** A black frame under the HUD. |
| `R5-nearplane-s13634-m6-t13` | Open space and a small hull: it looks clean, although the metric says the camera is inside rock. |
| `R5-nearplane-s99-m9-t12` / `-t13` | Clean of rock; a frame-crossing cyan plume and grey blurred rock "sausages" in the foreground. |
| `R5-nearplane-sheet` | The four above: one black, three usable. |
| `R5-keys-panel` | A clean reference card with a full mark legend; the bottom row is cut off. |
| `R5-tutorial-dismiss-before` / `-after` | A backed card, then gone 1 s after the click. Behind it, the front-lit Mothership reads as a server rack in front of a flat-white giant. |
| `R5-fleet-staged-wide` | **A real battle at a readable range:** frigates, a carrier and a wreck are all visible. It is spoiled by a 64 px cloud of merged white impact discs. |
| `R5-fleet-staged-close` | **The best frame in the project.** Rust-trimmed destroyers with short plumes, beams with a core, a charred wreck behind. Cotton-ball impacts of 25–38 px on the left. |
| `R5-shell-title` / `-briefing` / `-paused` | Unchanged from R4. Title and briefing are strong as UI but in a different art style from the game. Pause is clean. |
| `MANIFEST.md` | Exemplary: methods, contamination flags and failures all stated. |

---

## Would a stranger believe this is a commercial game?

**No. But for the first time, one frame would survive the question on its own.**

`R5-fleet-staged-close` could go on a store page: dark hulls with a shadow side,
beams with a core, a charred wreck drifting behind the line. Round 5 earned that
frame. A stranger does not see one frame, though. In the first ten minutes they
see:

1. **Engines that draw lines across the screen.** Three of the six close beat
   frames have plumes 3–4× the hull. A stranger reads them as tracers or a bug.
2. **A black screen** when the camera ends up inside a rock. It is rarer than in
   R4, but 3 in 20 focus moves is still several times a match.
3. **Battles they can only see as glyphs.** The played match is won or lost on
   sovereignty before 20 ships engage. The battle in the best frame had to be
   spawned.
4. **Damage as camouflage and shields as 2008 hexagons.** Both are on the ships
   at the moments the player watches most closely.
5. **Grey slab impostors** sitting in the middle distance of the best backdrops.

Round 5 did the hard thing: the death rework and the lighting contract are real
engineering, and they show. It also shipped two FX claims (the shield patch and the
plume cap) that its own evidence contradicts. **5.**

---

## Ranked fixes for round 6

1. **Enforce the plume cap and kill the shafts** (`src/fx/engines.js`,
   `src/fx/weapons.js`).
   - Clamp plume length in world units to 0.35× the hull's length *after* any
     speed or boost scaling, for every class and both teams.
   - Clamp trail ribbons to the same budget.
   - Identify the Lance Bomber's orange shaft: if it is fire, make it short beads
     at a firing cadence; if it is a plume, the clamp covers it.
   - Fix the plume harness so the hull is in frame, with the camera at ≥3× hull
     length.
   - Acceptance: no plume longer than 0.4× hull in any beat or plume frame.
2. **Camera: a hard guarantee, not a statistical one** (`src/core/camera.js`).
   - After the sphere-cast pull-in, test the near-plane quad against rock bounds.
   - If it still intersects, dither-fade that rock to zero, or hold the previous
     camera position, before the frame renders.
   - Make the focus path reject any position inside a rock's bounding sphere
     plus the near distance.
   - Acceptance: 50 moves across three seeds, odd moves adversarial, **0** frames
     with back > 0.
3. **Damage and char tied to hits** (`src/render/materials.js`, and damage state
   in `src/ships/index.js`).
   - Store up to 8 hit positions per instance and grow scorch and cracks only
     around them.
   - At 50%: three to five local scorched zones, with most of the hull clean.
   - At 20%: large burned regions, still with clean plating between.
   - Cracks are white-hot only within a few seconds of a hit, then cool to dark
     red.
   - Wrecks get their own, darker char, not the peach speckle.
4. **Impacts, flashes and shields at the distance people watch** (the impacts and
   shield modules in `src/fx/`).
   - Cap every impact's saturated core at about 8 px *at any camera distance*
     beyond focus, not only at the wide recipe, and draw it as a star, not a bloom
     disc.
   - Delete the hex-tile shield shader. A shield hit is a soft, local, short-lived
     ripple at the hit point.
   - Remove the lens-flare cross from small-ship deaths, and size the flash from
     the hull's current screen size, spikes included.
   - Shock rings are thin hairlines with no radial speed lines.
5. **The backdrop's remaining tells** (`src/render/skybox.js`, and the impostor in
   `src/ships/index.js`).
   - Remove the density-edge darkening that draws contour bands in the bright
     regions of the ironmoth and emberfall palettes.
   - Cap any bright feature at 30% of the frame, and reject seeds whose bright
     blobs pair up.
   - Give the hull impostor the key-light terminator and a contrast floor against
     its local background, so no hull renders as a flat grey slab.
   - Put the planet's lit side on a gradient: it samples 161–185 flat in
     `R5-s13634-first-contact-close`, `R5-damaged-friendly-50-fleet` and the
     tutorial frames.
6. **Make the played match produce the battle the art is built for, and survive
   its own boot** (seam drain and the AI muster in `src/sim/`, and renderer boot
   in `src/render/`).
   - Slow sovereignty drain, or raise the commander's attack threshold, until a
     normal match reaches 30+ engaged before minute 12.
   - Explain seed 13634's 1-warship opening.
   - Find the seed-2718 VALIDATE_STATUS shader failure and handle
     `webglcontextrestored` by rebuilding the scene, rather than parking on a
     message.

**Evidence required for round 6:**

- **The same three seeds at the same four beats.** State the opening fleet counts
  against R4 and R5.
- **Engine plumes with the hull in frame:**
  - a friendly interceptor, a hostile missile corvette and a Lance Bomber at
    cruise;
  - plus the bomber firing;
  - each with plume length divided by hull length, measured.
- **50 focus moves across three seeds** with the ray metric, and a frame for every
  sample where back > 0.
- **A damaged friendly at 80%, 50% and 20%,** with all hits from one side and a
  frame of the *other* side, to show the damage tracks the hits. Plus a wreck at
  +20 s.
- **Death strips** for an interceptor, a cruiser and a carrier at focus distance,
  plus **a shield hit at focus distance with shields up.**
- **An impact size table:** the largest saturated core, in px, at focus distance,
  at fleet-close distance and at the wide recipe, from live frames.
- **A fleet battle from a played match,** or a statement of the AI and drain
  changes that were tried and why they failed.
- **Ten consecutive boots of seed 2718,** with console logs and context-loss
  counts.
- **2× crops of the brightest nebula region** for ironmoth and emberfall.
- **The Mothership at the tutorial camera,** with a lit and shadow sample by the
  mask method.
