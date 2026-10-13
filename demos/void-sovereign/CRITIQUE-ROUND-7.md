# Critic round 7: 5/10. The sky is fixed and the hulls have plating; the ships, the rocks and the camera still give it away

**Method and limits.** A fresh-context art director scored the R7 evidence set
(`.local/shots/R7/evidence/`) and the fix-lane frames it cites, against
`CRITIQUE-RUBRIC.md`, in the format of round 6. All 16 beat frames, the three STAGED
fleet frames, the lineup sheet, the Mothership frame and its 2x crop, the damage frame
and both death strips were viewed. Verdicts that depend on detail were checked on
crops made with `crop.mjs`, saved to `.local/shots/R7/critic/` and cited as
`critic/…`. Flash extents were measured with PIL thresholds (≥200 luminance). The
camera's 50-move totals were recounted from `fix3-a2.log`. The game was not run.

**No blind A/B against Homeworld was performed.** The reference stills are copyrighted
and cannot be fetched, so the "pick out the browser one" test was not run, and nothing
here is a side-by-side comparison.

**Evidence limits.**

- **The fleet battle is STAGED** (spawned fleets, 32–33 hostiles engaged). It shows
  what the art can do in a battle; it does not show that the game produces one. The
  played beats have 0 to 17 hostiles engaged, and the late beats have only 0 to 7.
- **The haze A/B is not controlled.** `fix1-a4-*-hazeoff` was shot about a second
  after its partner, from a different framing, so on/off cannot be compared pixel for
  pixel.
- **The carrier strip misses the kill moment.** Frame 02 is at 3.64 s; the kill was at 2.53 s.
- **Flicker, fade timing and the haze ramp cannot be judged from stills.**

| Axis | R5 | R6 | **R7** | Δ | Why |
|---|---|---|---|---|---|
| Art direction & composition | 5 | 5 | **5** | = | The STAGED close is the best frame the project has produced. In play, though, 4 of 16 beats are failed framings. |
| Hull design & silhouette | 5 | 5 | **5** | = | No geometry changed. The lineup proves the hostile is still the player's silhouette with different paint. |
| Materials & shading | 5 | 5 | **6** | +1 | Mothership stucco is now strake plating and the camouflage is gone. Bone shows only under a key light, and new aliasing appears. |
| Lighting & atmosphere | 6 | 6 | **6** | = | The haze is real but faint. Hull shadows are crushed (shadow/lit 0.023 at s13634). The planet is still a flat white disc. |
| VFX | 5 | 6 | **6** | = | Interceptor death is inside the hull; the carrier break-up is good. Hit flashes are still 2x the hull, and the kill flash has a disc rim. |
| Environment | 6 | 5 | **6** | +1 | The ironmoth rope is gone. Rocks are still charcoal facets, and faded rocks leave ghosts. |
| UI/HUD | 7 | 7 | **7** | = | The contact marks help the STAGED wide frame read by faction. Otherwise unchanged. |
| Sense of scale | 5 | 5 | **5** | = | Inside 1.5 km the haze does nothing, which is where every close sits. Fleets at 5 km are glyphs. |
| Readability in combat | 6 | 5 | **6** | +1 | `R7-fleet-s13634-mid` reads as two lines trading fire. Credit is for STAGED evidence only. Played, it is still 5. |
| Cohesion | 5 | 5 | **5** | = | Gunmetal against bone is a clearer faction language. Lumpy rocks, Lego hulls and blocky debris still look like three different kits. |

**Overall: 5.** The axis mean is **5.7**, the highest yet (R6 5.4, R5 5.5). The overall
score does not follow the mean, because what decides a stranger's verdict is unchanged:
the hull shapes, the close camera on frigates and the lack of a battle in play. **No
axis is at 3 or below, so the blocker rule is not triggered.**

## Did the five stuck axes move?

**One of five moved. Materials went from 5 to 6; art direction, hulls, scale and
cohesion did not.** The diagnosis was right, but each of the two root causes was only
half treated. On root cause 1, the surface was fixed and the silhouette was not.
`R7-lineup-sheet` against `fix2-before-lineup-sheet` shows the same 13 outlines with
the hostile recoloured from rust to bone. That is still a palette swap at any distance
where a stranger cannot read plating, which is most of the game. On root cause 2, the
haze starts at 1.5 km and reaches only about 26% at 5 km. Every close frame sits inside
1.5 km, and every wide frame sits at about 5 km, so the beats change little.
`R7-s13634-first-contact-wide` still has near and far rocks at the same charcoal value.
Depth also needs value separation on the subject, and the hulls cannot give it: at
engagement close their shadow/lit is 0.023 to 0.057 (manifest §1), so the shadow sides
are close to black. That gives no depth, only silhouettes against black.

---

## Per-fix verdicts

### Fix 1 (05283d4), aerial perspective: **PARTIAL. It exists and it is too weak to change a frame.**

- **Visible where rocks are far:** the lone rock in `R7-s99-first-contact-wide`
  (about 1100, 300) is lifted to warm grey against the near cluster, and the far
  rocks in `R7-s2718-engagement-wide` fall back into the amber.
- **Not visible where it matters:** `R7-s13634-first-contact-wide` and
  `R7-fleet-s13634-wide` have near and far rocks at one charcoal value.
- **The A/B is uncontrolled:** `fix1-a4-s13634-first-contact-wide` and its `-hazeoff`
  partner have different framing and time.
- **Not verified from any frame:** the 26% and 50% figures, the hull cap of 0.40 and
  the rock cap of 0.75.
- **The emissive exemption is plausible:** windows stay crisp in
  `R7-s2718-first-contact-close`.

### Fix 2 (a0e2e7e + a1b7d6b), hull surfaces and faction: **PARTIAL.**

| Claim | Verdict | Evidence |
|---|---|---|
| Keel-axis strakes with recessed seams | **Verified** | `R7-mothership-tutorialcam-s2718-crop2x` against `fix2-before-…-crop2x`: horizontal strakes and offset seams replace blue blotch camouflage. This is the clearest gain of the round. |
| Texel checker and camo removed | **Partial** | The interceptor's orange-white blotch is gone (lineup before/after). `critic/r7-fleet-close-carrier-2x` still shows square tan and pink mottle the size of texels on the carrier. |
| Player gunmetal, hostile weathered bone | **Partial** | Bone reads on the carrier under a key light (`R7-fleet-s13634-close`). `critic/r7-destroyer-pair-2x` shows the hostile destroyer as near-black with orange trim, not bone. |
| Segmented rib rings | **Partial** | They read as stripes on the hostile frigate (`critic/r7-s2718-eclose-flash-3x`). On the carrier's outriggers they are rows of black cubes, which look like teeth, not ribs. |
| Charred debris | **Partial** | The carrier break-up (`critic/r7-carrier-death-09-2x`) is charred. The interceptor's fragment (`critic/r7-int-death-03-3x`, right) is uncharred tan with blocky mottle. Some shards are flat pale slabs. |
| Hostile silhouettes | **Not done (as declared)** | `R7-lineup-sheet`: 13 of 13 pairs share an outline. |

**New artefact:** the frigate's upper deck at 100% health is a band of ragged
black-and-white speckle (`critic/r7-s13634-eclose-frigate-2x`). This looks like seam
detail aliasing at a grazing angle. The Mothership's white emissive strips still break
into glyph-like jaggies (`R7-mothership-…-crop2x`, top centre, and unchanged from before).

### Fix 3 (a04597e), close-camera composition: **PARTIAL. The numbers check out, but the test does not cover the frames that fail.**

- **Recount of `fix3-a2.log`:** 50 moves, 0 bad frames, worstBack 0. Settled rock over
  40% occurs on 1 move and the subject is out of frame on 6, as claimed. Rock passes
  40% at some point on 7 moves (`shareMax`), and the last frame is over 40% rock on 3.
- **The test population is strike craft only:** 21 scouts, 20 interceptors, 7
  corvettes and 2 bombers at 60 m. It contains **no frigate or capital**. The beats
  that fail are frigate closes:
  - `R7-s13634-engagement-close`: about half the frame is a flat-shaded, low-poly rock
    slab under the hull. It sits behind the subject, so the fade does not apply.
  - `R7-s99-engagement-close`: an empty black frame with a dark frigate about 230 px
    long and two translucent ghost shapes (faded rocks).
  - `R7-s2718-first-contact-close`: the subject is about 20 px, and the Mothership's
    flank takes a third of the frame.
- **Good closes exist:** `R7-s37-engagement-close` and `R7-s99-first-contact-close`
  are clean, with no rock owning the frame.

### Fix 4 (6cbdbe2), nebula root cause: **VERIFIED by eye. The number is not traceable.**

- **The rope is gone:** `fix4-before-s99-sky-b` (braided, ringed bumps) against
  `fix4-a6-s99-sky-b` (soft dust lane). All four seed-99 beats and both seed-37 wides
  show soft cloud, with no closed contours.
- **The claimed 0.286 → 0.024 does not appear in any `fix4-*.json`.**
  - `fix4-before.json` has no entries for seed 99 or 37.
  - The metric is unstable when few pixels fall in band: `edgeMid` is 0.9087 at 526 px
    (`fix4-a6`, s99 sky-a).
  - Report it with the pixel count, or drop it.
- **Side effect:** ironmoth is now dimmer, flatter grey smoke. It is correct, but no
  longer an enormous nebula (rubric §3.9 P1).

### Fix 5 (34d8a39 + 649f4a4), close-range flashes: **PARTIAL.**

| Claim | Verdict | Evidence |
|---|---|---|
| Strike-craft death inside the hull | **Verified** | `R7-death-interceptor-focus-03`: the ≥200 core is 166x141 px against the pre-hit hull's 463x201 px (0.36 of its width). R6 had a 510x540 X. |
| One `hullBudget` at every distance | **Contradicted** | `R7-s2718-engagement-close`: the hit flash at ≥200 is 107x151 px on a hull of about 57x103 px, roughly 1.9x by 1.5x. |
| Star spikes 1 px | **Not verified** | `critic/r7-int-death-03-3x` and `critic/r7-s2718-eclose-flash-3x` show 12 to 20 tapered rays, several px wide at the root. It still reads as a lens starburst. |
| Kill flash with no disc edge | **Contradicted** | `critic/r7-int-death-03-3x`: a white ball about 75 px across with a clean circular rim, beside the starburst. |
| Ion beams a few metres wide | **Verified** | They are 2–3 px lines in `R7-s2718-engagement-close`, `R7-s37-first-contact-close` and `R7-fleet-s13634-close`. |
| Carrier death as sparse embers | **Verified, but the kill is missing** | `R7-death-carrier-focus-09`: charred sections drift apart in a spray of orange embers, the best destruction frame yet. The kill moment was not captured. |

---

## Regressions

1. **Ghost rocks:** the fade leaves translucent shapes on screen
   (`R7-s99-engagement-close`, top right and bottom left).
2. **Deck speckle at full health** (`critic/r7-s13634-eclose-frigate-2x`). It is
   probably the new seam detail aliasing, and it reads as damage.
3. **Faction read depends on light.** The hostile destroyer is near-black
   (`critic/r7-destroyer-pair-2x`), so bone does not hold as a faction colour at fleet
   range.
4. **Process:**
   - The nebula figure cannot be traced.
   - The haze A/B is not a matched pair.
   - The damage frame is backlit against the planet again (`R7-damage-friendly-50-focus`),
     though R6 asked for front-lit, and no 20% frame was shot.
5. **Still unaddressed from R6:**
   - damage is a speckle band along the upper hull, not zones;
   - the planet's lit side is a flat white disc (`R7-fleet-s13634-wide`,
     `R7-damage-friendly-50-focus`);
   - no Lance Bomber firing frame;
   - no played battle.

---

## One-line read of each new frame

| Frame | Read |
|---|---|
| `R7-s13634-first-contact-wide` | Two charcoal rock masses own about 45% of the frame, at one value regardless of distance. The fleet is glyphs over soft blue and orange cloud. |
| `R7-s13634-first-contact-close` | A dark corvette of about 150 px, nearly a silhouette, among rocks. Not a close. |
| `R7-s13634-engagement-wide` | A tan hostile capital top left (blocky, windows lit) and a rock cluster owning the right. The fight is a small spark cluster. |
| `R7-s13634-engagement-close` | **Failed framing.** A frigate parked on a flat-shaded rock slab covering about half the frame, with deck speckle. |
| `R7-s99-first-contact-wide` | The ringed giant is hazed and dim, a far rock lifts nicely and the soft grey cloud replaces the rope. The fleet is glyphs. |
| `R7-s99-first-contact-close` | **Best played close.** A corvette with a correct drive, a bomber below and soft dust behind. It reads as a game. |
| `R7-s99-engagement-wide` | A handsome dust lane with a capital cut off by the HUD, but 2 engaged and nothing happening. |
| `R7-s99-engagement-close` | **Failed framing.** A small dark frigate in black space with two ghost rocks. |
| `R7-s2718-first-contact-wide` | A bone shipyard hull on fire at left, rocks receding into amber and glyphs. Decent depth. |
| `R7-s2718-first-contact-close` | **Failed framing.** The subject is a 20 px speck. The Mothership flank is the accidental subject and the only real scale cue in the beats. |
| `R7-s2718-engagement-wide` | **Best played wide.** Layered rocks backlit by warm cloud, a beam, tracers and 7 engaged. |
| `R7-s2718-engagement-close` | A starburst about twice the size of the hull swallows a ribbed hostile frigate. A red beam crosses the frame. |
| `R7-s37-first-contact-wide` | A violet cloud and pale lifted rocks. Clean, with glyphs and no event. |
| `R7-s37-first-contact-close` | A dark ribbed hostile corvette taking white hit bursts, with rocks on both sides. Busy, but legible. |
| `R7-s37-engagement-wide` | A big rock, a violet wisp and a small fire cluster. Mostly empty. |
| `R7-s37-engagement-close` | A clean gunmetal frigate with a short drive and a beaded missile trail. Tidy and plausible. |
| `R7-fleet-s13634-wide` (STAGED) | A white planet disc behind rocks owning about 45% of the frame. The battle is orange and cyan marks. Readable as a map, not as a spectacle. |
| `R7-fleet-s13634-mid` (STAGED) | Two lines trading tracers and flashes, divided by a large rock. The first frame in seven rounds that reads as a fleet fight. |
| `R7-fleet-s13634-close` (STAGED) | **The best frame of the project.** A bone carrier with three orange drives, taking a beam, framed by rocks and blue dust. At 2x it is a Lego catamaran with texel mottle and cube teeth. |
| `R7-lineup-sheet` | The faction colours read; the silhouettes are identical pair by pair. |
| `R7-mothership-tutorialcam-s2718` (+crop) | Strake plating with seams: no longer stucco, but a pale brick-wall regularity, emissive jaggies and a flat streaky planet behind. Lighting holds at 0.131. |
| `R7-damage-friendly-50-focus` | Backlit against a white disc again. Orange flecks along the upper hull, a speckle band rather than zones. |
| `R7-death-interceptor-focus-00…10` | A contained starburst, a hard-rimmed ball, tan blocky debris and gone by 09. Much better than R6's X; not yet clean. |
| `R7-death-carrier-focus-00…10` | Smoke, burning hull, then a charred break-up in embers. Good, with the kill frame missing. |

---

## Would a stranger believe this is a commercial game?

**No, though it is closer than at any earlier round.** `R7-fleet-s13634-close`
would pass as a screenshot from a mid-budget 2000s space RTS. That is the first time
any frame has. In ten minutes of play, a stranger would still see:

1. **Twin ships in two colours.** Every hostile is the player's hull in bone. At fleet
   range, where colour carries less than shape, the factions blur.
2. **Boxes.** Hulls are extruded prisms with cube greebles, rocks are lumpy charcoal,
   and debris is flat slabs. Plating improved the surface of the box, not the box.
3. **A camera that loses frigates.** It shows a rock slab, a black void or a speck.
   Strike-craft closes are now fine.
4. **Black shadows.** Hulls go to silhouette in shadow, so most closes are dark shapes
   with a blue drive.
5. **No battle in a played match**, for the fourth round running. The best frames are
   STAGED.

The engineering remains honest, and two R6 failures, the nebula and the strike-craft
death X, are genuinely fixed. **5.**

---

## Ranked fixes for round 8

1. **Hostile geometry and the box problem** (`src/ships/`). Targets: hulls, cohesion,
   art direction.
   - Give hostiles their own silhouettes, at least for the classes on screen most:
     interceptor, bomber, corvette, frigate and carrier. Use tapered, ribbed,
     asymmetric bone forms, not the player's prisms.
   - Replace the cube-teeth "ribs" with bevelled bands.
   - Acceptance: a lineup sheet of black silhouette masks where a stranger can tell
     the factions apart in 13 of 13 pairs.
2. **Value structure, not just haze** (`src/render/`). Targets: lighting, scale, art
   direction.
   - Raise the hull shadow floor with a sky fill or rim, so that shadow/lit at focus
     is about 0.06 or more and planes stay readable.
   - Start the haze ramp near 500 m, so near and far rocks separate inside a wide frame.
   - Acceptance: a matched haze on/off pair (same frame, same time) and a measured
     near-rock/far-rock luminance gap on `R7-s13634-first-contact-wide`.
3. **Close camera for frigates and capitals** (`src/core/camera.js`). Targets: art
   direction, readability.
   - Extend the 50-move test to every class, with at least 15 frigate or capital moves.
   - Reject rock behind the subject over 40% as well as rock in front, and reject
     subjects under 8% of frame height.
   - Do not leave translucent ghosts: fully hide faded rock, or fade it to a dither.
4. **Make a played match produce a battle** (`src/sim/`, fourth ask). Targets:
   readability, scale, art direction. The STAGED mid frame shows the art is ready; the
   game must deliver it.
5. **Rocks and planet** (`src/render/`, environment). Targets: environment, cohesion.
   - Smooth the close-range rock LOD; the slab in `R7-s13634-engagement-close` shows
     about 8 flat facets.
   - Thin the rock fields in hero lanes; give the planet's lit side a terminator and a
     limb gradient.
6. **Flashes, damage and aliasing** (`src/fx/`, `src/render/materials.js`). Targets:
   VFX, materials.
   - Hold hit flashes to the hull budget at engagement range, cut the rays to 4 to 6,
     and remove the disc rim.
   - Show damage as zones, front-lit, at 50% and 20%.
   - Filter the seam detail at grazing angles; fix the Mothership's emissive jaggies.
   - Char every debris piece.

**The top round-8 fix is #1.** Hulls and cohesion cannot move while the enemy is the
player's ship in another colour, and the lineup sheet proves it.

## Evidence required for round 8

- **The same 16 beats** (seeds 13634, 99, 2718 and 37), with subject screen height in px,
  rock share (in front and behind), and shadow/lit for every close.
- **Lineup sheet in colour and as black masks**, before and after, for all 13 classes.
- **A matched haze pair:** same frame and time, on and off, at first-contact wide on
  13634 and 2718, with near/far rock luminance.
- **The 50-move camera test across all classes,** with its JSON committed beside the frames.
- **A played match with at least 30 hostiles engaged,** wide, mid and close, with
  timestamps. Otherwise, the drain and AI changes that were tried and why they failed.
- **Death strips** for an interceptor (with a frame at kill + 0 to 30 ms) and a carrier
  (with the kill frame). Report the flash bounding box divided by the hull bounding box.
  Include one hit-flash measurement at engagement range.
- **Damage at 50% and 20%, front-lit,** hits clustered at the stern, plus one frame at
  fleet range.
- **Nebula metrics** for seeds 99 and 37 before and after, with the in-band pixel count.
- **The Lance Bomber firing,** with the hull in frame (third ask).
