# Critic round 4: 5/10, with a real battle on screen and a cartoon death to go with it

**Method and limits, stated first.** A fresh-context art director scored 51 R4
frames against `CRITIQUE-RUBRIC.md` and `ARCHITECTURE.md` §3, using round 3's
frames (`.local/shots/R3/`) for comparison. **No blind A/B against Homeworld was
performed.** The reference stills are copyrighted and cannot be fetched, so the
§4 "pick out the browser one" test was **not** run, and nothing here is a
side-by-side. Every claim about a detail under ~60 px was checked at 2–8× with
nearest-neighbour magnification, and every brightness claim was checked by
sampling pixels. Crops are in `.local/shots/R4/critic/` and are cited below as
`critic/…`. The developers' `fix*` and `dmg*` before/after pairs were treated as
their own exhibits and were used only where no neutral frame exists; each use is
marked **(dev exhibit)**. The game was not run.

**Evidence limits.** Frames were shot live at ×1, so FX density is honest.

- **The fleet battle is staged:** 67 against 86 warships spawned on one axis.
  It tests load, not a real match, and the spawn makes the HUD read
  **POPULATION 215 / 55**.
- **Both death subjects are hostile.** The only damaged friendly is a dev
  exhibit (`dmgfix-*`).
- **The interceptor dies 160 m from the camera,** so its flash sizes are an
  upper bound, though the focus camera can get that close.
- **Stills cannot show** the legend or the Dismiss bug.

| Axis | R2 | R3 | **R4** | Δ |
|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = (best frame yet and worst frame yet) |
| Hull design & silhouette | 4 | 5 | **5** | = (the lineup helps; fleet range does not) |
| Materials & shading | 5 | 5 | **5** | = (red gone; texel crawl and exposure drift found) |
| Lighting & atmosphere | 5 | 5 | **5** | = (planet fixed; hulls and rocks not) |
| VFX | 4 | 5 | **4** | **−1** (death staging) |
| Environment | 6 | 6 | **6** | = |
| UI/HUD | 7 | 7 | **7** | = |
| Sense of scale | 5 | 5 | **5** | = |
| Readability in combat | 4 | 5 | **6** | +1 (staged load only) |
| Cohesion | 5 | 5 | **5** | = |

**Overall: 5.** The mean is 5.3, the same as round 3. **No axis is at ≤3**, so the
blocker rule is not triggered, but VFX has dropped back to 4, one step from it.

Round 4 delivered four things round 3 asked for: the orange confetti is gone,
friendlies no longer turn red, kinetic fire reads as rounds, and the gas giant
has a night side. For the first time a frame would pass as a space battle
(`R4-fleet-s13634-wide`). But round 4's own evidence also shows a death that
**deletes a 620 m cruiser in a tenth of a second and replaces it with clip
art**, and a close camera that renders the inside of an asteroid. Those cancel
the gains.

---

## Per-fix verdicts

### Fix 1 (f4330a8), damage: **PARTIAL. The colour is fixed; damage now barely reads, then reads as a pattern.**

- **Red is gone (dev exhibit).** `dmgfix-OLD-0.2` is the R3 lava camouflage;
  `dmgfix-NEW-0.2` is a clean blue-trimmed hull. Verified.
- **At about 50% it is invisible in play.** The hostile cruiser at **48% hull**,
  1650 m away (`R4-death-cruiser-02`, `critic/dc02-damage.png`, 3×), shows a few
  darker panels, one 10 px orange glow and **no cracks**. A stranger would call
  it intact.
- **At 90% it is a decal (dev exhibit).** `critic/dev-dmgfix-NEW-0.9-hull.png`
  is a near-black hull covered **uniformly** in a peach worm-maze, the same
  density on every panel, turret and engine block. Dark first is right, but the
  damage is not tied to the hits and the lines are peach, not white-hot. It
  reads as circuit-board camouflage.
- Round 3's acceptance test (a friendly at 20% hull, three-quarter view,
  120 px) is **untested**: no frame shows it.

### Fix 2 (20f2e07), seam capture ring: **VERIFIED, at a price.**

- **It is now an overlay, not fire.** In `critic/fcw13-centre-marks.png` (4×)
  it is one continuous hairline with short, uniform, perpendicular ticks, and
  ownership is a solid arc against a dashed remainder. None of it is amber or
  blurred by depth of field. Nobody will mistake it for incoming fire.
- **It is too heavy.** The ellipses are the largest drawn shapes in all four
  wide beat frames and in the fleet-wide frame. In the s13634 wides they sweep
  across half the frame in **full-strength friendly cyan**, the hue of the
  friendly marks. "Flat neutral" holds only for *contested*.
- **Edge-on, it slices the backdrop.** In `R4-s99-engagement-close` it is a
  straight hairline through the planet
  (`critic/ec99-hairline-stretched.png`, contrast stretched).
- **Its label prints over explosions:** "SEAM · THEIRS 9%" sits on the impact
  cloud in `critic/fw-impacts.png` (4×).

### Fix 3 (5f04195), weapon fire: **PARTIAL. Kinetic fire is fixed; beams are not.**

- **Kinetic fire works.** In `critic/fw-beams.png` (2×), rounds are bright heads
  with short tapering wakes, and their direction reads. This is the round's
  clearest VFX win.
- **Beams are still laser pointers.** The same crop shows three white beams of
  400–500 px with constant width and brightness, no core/shell split and no
  flicker, running emitter to target like order lines.
- **Bomber fire is a shaft, not a bead:** a thick continuous orange beam of
  about 500 px (`critic/fcc99-impact.png`, 3×).

### Fix 4 (344c8ed, 48f09c0), rim light, rocks and focus: **PARTIAL.**

- **The rim light is present.** `critic/ec99-hull.png` (3×) shows a cold blue
  edge on the shadow-side lower edges of the ion frigate.
  `critic/lu11-shadow.png` shows the same, faintly, on the cruiser's underside.
  Verified.
- **But in-play hulls have no shadow side to rim.** The frigate in
  `R4-s13634-engagement-close` samples **100–160 along its whole length**
  (`critic/ec13-hull.png`): silver end to end, no terminator. The lineup
  cruiser samples 5–15 with highlights at 100+. The contract holds on the model
  sheet, not in the game.
- **Asteroids: NOT VERIFIED.** The big rock in `R4-s13634-engagement-wide`
  samples **70–85 flat** across its mass and drops straight to space at the
  edge, with no shadow side; its texture is stretched into streaks
  (`critic/ew13-marks.png`). The first-contact rocks have only a soft vertical
  gradient (`critic/fcw13-rocks-left.png`).
- **Focus: three of four close frames pass.** `R4-s13634-engagement-close`,
  `R4-s99-engagement-close` and `R4-fleet-s13634-close` frame the subject on
  open space or the planet. The fourth, `R4-s99-first-contact-close`, is the
  worst frame in the set: the near plane is inside a rock, and about 40% of the
  frame is a flat black polygon with ruler-straight edges
  (`critic/fcc99-nearclip.png`).

### Fix 5 (8b37c4b), fleet-range presence: **PARTIAL. Three of the six claims hold.**

| Claim | Verdict | Evidence |
|---|---|---|
| Engine glow capped to hull size | **Partial** | It holds at fleet range (`critic/fw-friendlies.png`: blue glow about ⅕ hull). It breaks up close: the hostile corvette's plume is about **1.15× hull length** (`critic/fcc13-corvette-plume.png`, ≈265 px against a ≈230 px hull), and R3 measured 0.12–0.15×. |
| Long trail hairlines fixed | **Verified, mostly** | No frame-spanning lines remain. Short curved grey hair-arcs still appear in `critic/ew99-fight.png`. |
| Hull floor of 9–12 px | **Not verified** | At the wide recipe no hull is visible inside the glyphs (`critic/ew13-glyphs-6x.png`, 6×). At fleet-close distance the strike craft are ≈8×2 px smudges a few levels above the nebula, and the diamond mark is bigger than the hull (`critic/fc-strikecraft-8x.png`). Size without contrast is not presence. |
| Amber class outlines for hostiles | **Verified, with faults** | There are class-shaped amber outlines (`critic/fcw99-centre.png`, `critic/fw-hostiles.png`). They float off their hulls and outnumber the visible hulls about 3:1 on the left of the fleet frame. A third, **red** outline appears in `critic/ew99-fight.png` and `critic/fcw99-centre.png` with no explanation. |
| Legend | **Not verified** | The keys panel is collapsed in every frame. |
| Impacts as a cross-star | **Not verified at range** | At fleet range the impacts are round white bloom discs of 12–20 px that merge into one white cloud (`critic/fw-impacts.png`); there is one small star in the whole crop. Up close they are stars, but oversized (see the capture-lane defects). |

### Fix 6 (0e11849), planet: **VERIFIED in one seed, partial in the other.**

- **`R4-s99-engagement-close` (`critic/ec99-planet.png`) is the best backdrop
  this project has shown.** Night side **20–23**, lit side **165–192**, space
  **4–5** (sampled). The terminator is a soft band that follows the cloud
  bands, the halo is weighted to the lit limb, and the ring leans about 25° and
  reads as a ring, not a floor. One miss: the ring takes no shadow from the
  planet.
- **`R4-s13634-first-contact-wide` is weaker** (`critic/fcw13-planet-ring.png`).
  The ring is at about 13° and still spreads across the lower right as a banded
  plane, the lit limb blows out to a white smear in the corner, and the disc is
  almost all night side, so R3's big readable planet is lost.

### Capture-lane defects, checked

1. **The heavy cruiser's hull is gone within 0.1 s of the kill: VERIFIED.**
   `R4-death-cruiser-03` (kill +0.10 s) shows four white blobs and no hull.
   `R4-death-cruiser-04` shows blasts strung along an axis where there is no
   longer a ship.
2. **The interceptor's hit flash is bigger than the ship: VERIFIED, and that
   understates it.** Against a ≈95 px hull (`critic/di00-hull.png`), the hit
   flash is ≈210 px, or **2.2×** (interceptor-01). The kill flash is a ring
   with six thick spokes ≈545 px across, or **5.7×** (interceptor-03), followed
   by a ≈650 px orange lens-flare cross (interceptor-04).
3. **The tutorial Dismiss button does nothing: NOT VERIFIABLE from stills.**
   Consistent with it: the card is still up at 00:14 in
   `_rejected/R4-fleet-s13634-wide.tutorialcard.png`, and the run had to wait
   29 s. That frame also shows the card's prose **unbacked over the battle**,
   with hostile marks running through the text.
4. **The seed-99 close camera clips a rock: VERIFIED, and worse than
   reported.** See fix 4. This is a frame-ruining defect, not a follow-lag
   quirk.

---

## Regressions found

1. **Death staging is now the loudest amateur signal in the build.**
   - **The hull is deleted at the kill** (cruiser-03), and **there is no
     wreck**: cruiser-10 (+23.5 s) is empty space, although the probe reports
     "wreck ends +59 s" and 52 debris pieces.
   - **The interceptor's kill effect is clip art:** a cream ring with six
     spokes, like a cartoon sun or a settings icon (interceptor-03).
   - **The cruiser's final blast is a frame-filling shock ring,** visibly
     **faceted** into straight segments (`critic/dc06-ring.png`, 2×) and
     crossed by a dead-straight white streak (cruiser-06). It reads as a
     firework.
   - **Scale is inverted.** The 14 m interceptor's flash is bigger on screen
     than the 620 m cruiser's whole hull was in cruiser-00.
   - The timing is fine, about 10:1 on light-out. The content is the failure.
2. **The engine plume is back above its cap on moving hulls.** It is about
   1.15× hull length on the hostile corvette (`critic/fcc13-corvette-plume.png`)
   and longer on the escort at the bottom left of the same frame. This is
   round 2's model-rocket read, in orange.
3. **The seam ellipses have become the composition.** See fix 2. The rings
   took the orange confetti's place as the dominant non-diegetic shape.
4. **Newly exposed by the lineup, not new code:**
   - **Detached geometry:** the carrier's outrigger pods float with no strut
     (`critic/lu12-pods.png`); white wedges float beside the cruiser
     (`critic/lu11-shadow.png`); the collector tows a pod across a gap
     (`critic/lu06-tow.png`); the support frigate has loose grilles.
   - **The hostile faction is a palette swap:** every class is the same hull
     in orange.
   - **The interceptor is a folded-paper plane in blotch camouflage**
     (`critic/lu02-paint.png`, 4×).
5. **Newly exposed by close frames:**
   - **Texel crawl.** Frigate hull textures alias into pixel noise, like an
     unmipmapped texture (`critic/ec13-hull.png`, `critic/ec99-hull.png`, 3×).
   - **Exposure drift.** Lineup hulls are near-black, in-play hulls pale
     silver, and the hostile corvette at 2:48 near white with flat orange
     blotches.
6. **The seed-99 nebula reads as a noise filter.** About 60% of
   `R4-s99-first-contact-wide` is grey marbling with hard dark contour lines,
   like brain coral (`critic/fcw99-nebula.png`). The same worm lines thread
   through the nebula behind every lineup frame.
7. **Unaddressed from round 3:** the production panel is still unbacked over
   hulls, with the cruiser's barrels running through the prices
   (`critic/fw-panel.png`, 2×), and still has no class names. The title art and
   the Mothership-less briefing are unchanged.
8. **To verify, not yet a bug:** at the same 2:47–2:48 beat, seed 13634's HUD
   says "Sovereignty clock starts in 1:12", while seed 99's says "The middle is
   level" with THEM at 99. Either the clock start is seed-dependent and
   unannounced, or one of the two is wrong.

---

## One-line read of every frame

| Frame | Read |
|---|---|
| `R4-s13634-first-contact-wide` | No more orange rain. Two huge cyan ellipses now own the frame; the fight is 30 glyphs in a knot; the planet is a blown white corner. |
| `R4-s13634-first-contact-close` | Hostile corvette in pale grey with flat orange blotches, trailing a plume longer than itself; a capital cut off by the HUD. |
| `R4-s13634-engagement-wide` | No visible combat. One flat clay rock, two cyan ellipses and seven glyphs. |
| `R4-s13634-engagement-close` | Open framing works, but the frigate is uniformly lit silver with aliased texels: a pen, not a warship. |
| `R4-s99-first-contact-wide` | A marbled noise nebula fills 60% of the frame; the fight is a glyph cluster among rocks. |
| `R4-s99-first-contact-close` | **Broken.** The camera is inside a rock, which renders as a black polygon over 40% of the frame; a sun-icon impact sits beside it. |
| `R4-s99-engagement-wide` | Smeared-texture rocks frame a thin column of glyphs; a red mark nobody explains. |
| `R4-s99-engagement-close` | **The best frame in the set.** The ringed giant has a true night side and a tilted ring; the ion frigate is clean but flat silver. |
| `R4-fleet-s13634-wide` | **The first frame a stranger would call a space battle.** Two lines, readable fire, blue against amber. Let down by white impact blobs, laser-pointer beams and 215/55. |
| `R4-fleet-s13634-close` | The cruiser reads as a stack of pipes against a good nebula; to its right are diamonds with no visible ships inside them. |
| `R4-lineup-sheet` | Thirteen classes, most distinguishable up close; the hostile faction is the same models in orange. |
| `R4-lineup-01-scout` | A dish on a stick; it reads as a probe. |
| `R4-lineup-02-interceptor` | A folded-paper plane in blotch camouflage. |
| `R4-lineup-03-bomber` | A twin-pod knife; credible. |
| `R4-lineup-04-corvette` | A gun pod on a hull; credible. |
| `R4-lineup-05-missileCorvette` | A launcher box on a blade; the clearest role read in the roster. |
| `R4-lineup-06-collector` | A barge towing a disconnected pod. |
| `R4-lineup-07-assaultFrigate` | A long greebled blade; it blurs into the destroyer family. |
| `R4-lineup-08-ionFrigate` | A rifle barrel bolted to a hull; it reads as a weapon platform, crudely. |
| `R4-lineup-09-supportFrigate` | A heap of grilles and loose parts; it reads as scaffolding or debris. |
| `R4-lineup-10-destroyer` | **The best hull in the game**: a warship silhouette with a believable heading. |
| `R4-lineup-11-cruiser` | Good panel density; accordion barrels and floating wedges. |
| `R4-lineup-12-carrier` | A catamaran whose outriggers float free. |
| `R4-lineup-13-mothership` | A dark brick with a handle, not the 1.9 km hero the briefing promises. |
| `R4-death-cruiser-strip` | A ship, then blobs, then a firework ring, then nothing. |
| `R4-death-cruiser-00` / `-01` / `-02` | A credible capital in orange trim; hit 1/8 changes nothing; at 48% hull it still looks intact. |
| `R4-death-cruiser-03` / `-04` | The hull is gone, leaving four white dots, then blasts strung along an absent hull. |
| `R4-death-cruiser-05` / `-06` | Puff-billboard soot columns (the most physical frame), then a faceted frame-filling ring and a straight streak. |
| `R4-death-cruiser-07` to `-10` | Embers, then empty space; no wreck at +23.5 s. |
| `R4-death-interceptor-strip` | Oversized flashes, then nothing. Fast, as it should be, but cartoon-sized. |
| `R4-death-interceptor-00` / `-01` / `-02` | A ≈95 px ship, then two starbursts at 2.2× its size that hide it. |
| `R4-death-interceptor-03` / `-04` | A cartoon sun 5.7× the ship, then a frame-spanning orange lens-flare cross. |
| `R4-death-interceptor-05` to `-10` | Two embers, then empty space. |
| `R4-shell-title` | Unchanged since R3, and still a different art style from the game. |
| `R4-shell-briefing` | Unchanged; still the strongest screen, and still no Mothership image. |
| `R4-shell-paused` | Clean: the blurred Mothership in front of the giant works. |

---

## Would a stranger believe this is a commercial game?

**No, and round 4 shows why more clearly than round 3 could.**

There are now two frames a stranger might accept: the staged fleet battle and the
seed-99 frigate in front of the ringed giant. Put either on a store page and few
people would object. But a stranger does not see two frames. They see:

1. **Ships that vanish when they die.** A 620 m cruiser is deleted in 0.1 s
   and replaced by a ring and a firework. An interceptor dies under a cartoon
   sun six times its size. No shipped space RTS kills a capital this way.
2. **A camera that goes inside an asteroid** and shows a black polygon.
3. **Cyan ellipses across half the screen** in most early frames.
4. **At play distance, glyphs instead of ships.** The fleet battle works
   because the harness spawned 150 hulls close together. In the four beat
   frames of an actual match, nobody can point at a ship.
5. **Construction tells up close:** pixel-crawling hull textures, floating
   pods and wedges, and a hostile faction that is the same models recoloured.

Round 4 fixed its own list honestly and well in four places: red damage, the
fire-like ring, kinetic tracers and the planet. That raised the ceiling for the
first time. The death staging and the camera clip pulled the floor back down.
**5.**

---

## Ranked fixes for round 5

1. **Re-stage deaths around the hull, not instead of it** (the death and
   explosion emitters in `src/fx/`, and wreck handling in `src/ships/index.js`).
   - Never remove the hull mesh at the kill. Break capitals into 2–4 sections
     that drift, char toward near-black and secondary-detonate along their
     length, and keep them for the full measured wreck time.
   - **Delete the ring-with-spokes sprite.** Shock rings get 64+ segments,
     stay thin and are capped at about 2× the hull's screen length; remove the
     straight streak.
   - Cap every hit or death flash, lens-flare crosses included, at 1.2× the
     hull's *current screen* size.
   - Acceptance: a cruiser's broken hull is visible at kill +10 s, and no
     interceptor flash is larger than the interceptor.
2. **Camera near-plane safety** (`src/core/camera.js`).
   - Sphere-cast from subject to camera every frame, and pull in along the ray
     or fade any asteroid inside the near band, so the near plane never sits
     inside geometry.
   - Make focus-approach scoring reject paths *through* rock, not only rock
     backdrops.
   - Acceptance: 20 random focus moves across two seeds, with no back-face or
     interior fill in any frame.
3. **Hold the lighting contract in play, not only on the model sheet**
   (`src/render/materials.js`, `src/render/environment.js`).
   - Use one exposure and tone curve for lineup and match. In-play hulls keep a
     shadow side at ≤15% of the lit value, with the new rim on it.
   - Apply the terminator to asteroids for real: the `ew13` rock must not
     sample flat at 70–85.
   - Turn on mipmaps and anisotropic filtering for hull detail textures.
   - Seed damage cracks from per-instance hit positions, not uniform noise
     over the whole hull, and push the crack colour to white-hot.
4. **Fleet-range combat FX** (`src/fx/weapons.js`, the impacts module,
   `src/fx/engines.js`).
   - At range, impacts are cross-stars capped at about 6–8 px, never bloom
     discs. Beams get a core, a soft shell, width flicker and falloff.
   - Re-apply the 0.35× plume cap to moving and hostile hulls.
   - Give the hull impostor a contrast floor as well as a size floor.
   - Anchor hostile marks on their hulls; define the red outline or remove it.
5. **Quieten the HUD's world layer** (the seam overlay in
   `src/render/environment.js`, and `src/ui/`).
   - Draw seam rings at about 35% opacity, fade them with distance, cull them
     edge-on and keep labels clear of FX. *Yours* is a thin filled arc
     segment; the rest of the ring stays neutral bone.
   - Back the production panel and the tutorial card, and restore class names
     to production.
6. **Rebuild the nebula noise** (`src/render/skybox.js`). No ridged or
   thresholded bands in the density field, which is where the worm contours
   come from: use soft domain-warped fBm with dust lanes. Cap any single
   feature at about 30% of the frame.

**Evidence required for round 5:**

- The same two seeds at the same four beats, plus **one new seed**.
- **A damaged friendly**, live, at 50% and at 20% hull, from the focus camera
  and at fleet range.
- **Ten-frame death sequences** at gameplay focus distance (not 160 m) for an
  interceptor, a cruiser, and a carrier or Mothership, plus one death from the
  wide recipe.
- **20 focus-camera frames across two seeds**, auto-checked for near-plane
  intersection, with the result stated in the manifest.
- **A pixel table for the lighting contract.** In-play lit and shadow values
  for three hulls and two rocks, sampled the way this round sampled them.
- **The keys panel open**, showing the hostile-mark legend.
- **The tutorial card before and after a Dismiss click**, two frames
  timestamped 1 s apart.
- **A fleet battle reached in a played match, not spawned**, or state the
  staging and hide the population overflow.
- **Engine plumes at cruise speed** for a hostile corvette and an interceptor,
  measured against hull length.
