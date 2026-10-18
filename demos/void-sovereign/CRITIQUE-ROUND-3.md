# Critic round 3 — 5/10, a firmer 5, still not commercial

**Method and limits, stated first.** This round used a fresh-context art director
and eleven stills from the PR #29 branch: four gameplay beats, each with a wide
and a close frame, plus the title, briefing and pause screens. They were scored
against `CRITIQUE-RUBRIC.md` and `ARCHITECTURE.md` §3, and against round 1 and
round 2's archived frames. **No blind A/B against Homeworld was performed.**
Reference stills are copyrighted and cannot be fetched, so nothing here is a
side-by-side, and the §4 "pick out the browser one" test was **not** run. Scores
rest on the rubric, §3 and genre knowledge. Every claim about a detail under
~60 px was checked at 2–8× with nearest-neighbour magnification first. The crops
are in `.local/shots/R3/zoom/`.

**Evidence caveats that limit what this round can say:**

- **Different resolution.** R3 is 1600×900; R1 and R2 were 1920×1080. HUD
  proportions are not directly comparable.
- **One seed.** All R3 frames come from one match, so the cross-seed half of
  fix 6 **cannot be tested**.
- **No death is caught in any frame.** Fix 5 cannot be verified from stills.
- **All three close frames show the same class**, the assault frigate. A 9/13
  nameability claim cannot be checked against one class seen up close, one
  enemy capital seen at mid-range, and everything else as glyphs or sprites.
- **The fleet-battle beat has no battle in it.** At 10:39 it is 17 hulls against
  32 hostiles, against R2's 24 against 74 at 13:20, and the frame shows no
  visible engagement. Combat readability at load was **not re-tested**.
- **"Frozen across each pair" is not quite true.** RU changes between the wide
  and close frames (2,414 → 1,883 and 6,918 → 6,858), and a production entry
  appears in the queue. The world looks frozen, but the economy was not.

| Axis | R1 | R2 | **R3** | Δ |
|---|---|---|---|---|
| Art direction & composition | 4 | 5 | **5** | = |
| Hull design & silhouette | 3 | 4 | **5** | +1 (close range only) |
| Materials & shading | 4 | 5 | **5** | = (gain offset by a regression) |
| Lighting & atmosphere | 5 | 5 | **5** | = |
| VFX | 3 | 4 | **5** | +1 |
| Environment | 4 | 6 | **6** | = |
| UI/HUD | 6 | 7 | **7** | = |
| Sense of scale | 3 | 5 | **5** | = |
| Readability in combat | 3 | 4 | **5** | +1 |
| Cohesion | 4 | 5 | **5** | = |

**Overall: 5, the same as round 2.** The mean is 5.3. What changed is the
floor: round 2 had two axes at 4, one bad decision from re-blocking, and now
**nothing is below 5**. Three axes moved, and each by one point. Nothing crossed
into "good" except the two that were already there (environment, UI). Six fixes
landed in code, and on screen this reads as cleaning up regressions rather than
moving forward. The plumes and the seam shells were the two loudest amateur
signals in round 2, and both are gone. Neither was replaced by anything a
stranger would call impressive.

---

## Per-fix verdicts

### Fix 1 — Engine plumes: **LANDED. REGISTERS.**

- `zoom/ec-plume.png` (6×) shows a soft blue-white core inside a wide falloff
  shell. There is no hard tube silhouette, and the nozzle flange is covered.
  Length is roughly 0.12–0.15× hull, under the 0.35× cap. The R2 "model rocket"
  read is gone. Compare `round2/R2-first-contact-close.png`, where three hard
  white tubes run about 1.5× hull length, with `R3-first-contact-close.png`.
- The known inner-bore residue shows as a faint blue crescent at the nozzle in
  `zoom/fbc-hull.png` (3×, upper left). It is not visible at 1×. Acceptable.
- **New residual, not a regression:** at fleet range the plume collapses to an
  overexposed white blob, about 7 px across, that is **brighter and wider than
  the hull it belongs to**. See `zoom/fbw-blob.png` (8×): the selected friendly
  is a white comma inside a cyan bracket, with no hull visible. The two white
  blobs on the ring in `R3-engagement-wide.png` (≈822,362 and ≈890,352) are the
  brightest pixels in that frame. At the distance the game is mostly played, the
  engine *is* the ship.

### Fix 2 — Hull proportion: **PARTIAL. Registers at close range only.**

- **Assault frigate** (the only class shown close, three times):
  `zoom/ec-hull.png` and `zoom/fbc-hull.png`. It is clearly thinner than R2's
  slab, at roughly 8–9:1. The guns on outboard struts give real negative space,
  and the dark gunmetal with cyan trim reads as a warship rather than R2's
  white plastic. This is a real improvement.
- **But the bow does not resolve heading.** The bow is a blunt bundle of
  parallel rods with barrels sticking out, more tuning fork than tapered prow.
  In all three close frames, heading comes from the plume, not the bow. Cover
  the engine glow and it is a 50/50.
- **Enemy capital** (`zoom/ew-capital.png`, engagement-wide): short and deep,
  as promised. It reads as an **oil platform or a stack of shipping
  containers**, a brick with towers. Its mass reads; its purpose and heading do
  not. It is close to R2's enemy capital at the same 7:20 beat. The change is
  marginal.
- The forked carrier bow and the cruiser family are not visible in any R3
  frame.
- **The 9/13 nameability claim is unverifiable from this evidence.** At fleet
  range (`R3-fleet-battle-wide.png`, `R3-first-contact-wide.png`) **no class is
  nameable from the hull**. Every identification comes from the HUD glyph
  drawn on top. Enemy strike craft appear as unmarked peach four-point sprites
  (`zoom/fcw-stars.png`, 5×). Magnified, they are swept-wing fighters; at 1×
  they read as sparkles or debris. That is round 2's lesson again: the claim is
  made in a projection the game does not show.

### Fix 3 — Seams and ring language: **PARTIAL. The deletion registers; the replacement does not work.**

- **Removing the shells is the single biggest visible change between R2 and
  R3.** Put `round2/R2-fleet-battle-wide.png` next to `R3-fleet-battle-wide.png`:
  the five plastic lenses are gone, and the frame is calmer. Fully landed.
- **The tick ladder does not read as a ring.**
  - In `zoom/fcw-ticks.png` (2×), the ticks alternate between radial and
    tangential orientations along a perspective arc. At 1× the left half of
    `R3-first-contact-wide.png` reads as **orange rain or scattered tracer
    streaks**, not a boundary.
  - In the close frame (`zoom/fcc-ticks.png`), the ladder breaks up into
    salmon rods at random angles. Some are **softened by depth of field**,
    which means the rule mark is being rendered as world geometry, the one
    thing `environment.js:1532` says it must not be confused with. They look
    like laser bolts.
- **New collision, worse than the old one.** The ticks use the same orange
  family as the **hostile contact marks and hostile weapon fire**. In
  `zoom/fcw-center.png` a horizontal tick passes straight through a hostile
  bracket (≈0–130, 575 in the zoom). The old collision was three kinds of
  ellipse. The new one is "is that orange line a rule or a shot at me?", which
  matters more during combat.
- **The planet ring is still part of the battlespace.** In
  `zoom/ew-ring-ships.png`, two hulls sit *on* the ring's inner edge like cars
  on a racetrack. In `R3-first-contact-close.png` the ring fills the centre of
  the frame behind the frigate like a vinyl record. Between the wide and close
  frames it parallaxes as near-field geometry. Of R2's three-way ring
  collision, one part is deleted, one is replaced by a new collision, and one
  is untouched.

### Fix 4 — Combat legibility: **PARTIAL. Contact marks land; impact flashes barely register.**

- **Contact marks land and register.** Unselected friendlies now carry cyan
  class glyphs and hostiles carry orange marks. You can count both sides in
  `R3-first-contact-wide.png` and `R3-fleet-battle-wide.png`, which you could
  not in R2. This is the clearest gameplay-readability gain of the round.
- **Problems with them:**
  1. Hostiles use **two unexplained mark forms**, orange corner brackets and
     orange outlined diamonds (`zoom/fbw-center.png`). Nothing tells the player
     what separates them.
  2. Hostile marks carry **no class information**, so friendlies are glyphed
     by class and hostiles generically. You learn what you have, not what you
     face.
  3. **"Weighted" means unengaged hostiles stay unmarked.** In
     `R3-first-contact-wide.png`, seven enemy fighters are visible only as the
     peach sprites over the planet ring, and they read as sparkles.
  4. In clusters the friendly glyphs **overlap into a knot**
     (`zoom/fcw-center.png`, upper centre: six or more glyphs in about 40 px).
- **Impact flashes:** soft beige blobs of about 6–8 px (`zoom/fcw-center.png`,
  ≈535,255 in the zoom). They are just legible, but **indistinguishable from
  the engine blobs** described under fix 1. At fleet range a hit and an engine
  are the same white smudge.
- **Weapons fire is untouched since R2's regression #5.** `zoom/ew-marks.png`
  shows uniform-width cyan and orange hairlines from mark to target, with no
  taper, no head and no brightness falloff. They read as **order lines or
  laser pointers**, not fire. This was not on the R3 list, and it shows.
- **"Am I winning?" is still unanswerable** from any wide frame. The fight
  happens inside or behind the asteroid cluster in all three wide beats.

### Fix 5 — Death staging: **NOT VERIFIED. Does not register in this evidence.**

- No frame captures a death in progress, and the 149:1 duration ladder is a
  timing claim stills cannot show.
- The only post-death-looking residue is in `zoom/ew-smoke.png`: a diffuse cloud
  of round, soft, orange-brown billboard puffs. It has no directional structure
  that can be read. Visually it is the "clump of billboards" R2 complained about,
  though it may be lingering wreck smoke rather than the explosion.
- **Round 4 must capture a frame sequence** of one capital death and one
  interceptor death before this fix can be scored.

### Fix 6 — Lighting contract: **PARTIAL. Mostly does not register on screen.**

- **Cross-seed consistency: untestable**, because there is one seed.
- **The planet terminator looks the same as round 2's.** At the same 3:00 beat,
  `round2/R2-first-contact-wide.png` and `zoom/fcw-planet.png` show the same
  straight diagonal edge with no penumbra. The night side sits at roughly 35–40%
  value with the cloud bands clearly continuing through it. The limb halo runs
  at equal strength around the **dark** limb. The coordinate-frame fix may be
  correct in code, but it reads as a **translucent shadow decal laid over a
  lit disc**, not a terminator. It breaks the 17.76:1 contract on the largest
  object in every wide frame.
- **Hard terminators on hulls: yes, and they cost silhouette.** The frigate's
  shadow side is now near-black.
  - In `R3-engagement-close.png` and `R3-fleet-battle-close.png`, a dark hull
    sits in front of a dark asteroid of the same value. Without the cyan trim
    it would vanish. §3.2's "cold rim/fill bounce from the nebula" is missing.
  - Hulls in front of the planet are **flat black stickers**
    (`zoom/ew-planet-sil.png`, 5×), with no rim, haze or edge light.
  - "Silhouette first" was satisfied by the letter of the rule and against its
    intent.
- **Asteroids do not obey the contract.** `zoom/fcw-rock.png` (2×) is front-lit
  with no shadow side, although the planet in the same frame is lit from the
  right. In `R3-engagement-close.png` the large right-hand rock is brightest on
  its left faces. Asteroids fill 40–70% of every close frame, so in practice the
  lighting model most of the frame obeys is a flat one.

---

## Regressions found

1. **Friendly hulls splattered in saturated red-orange. New, and the worst
   thing in the round.**
   - `R3-first-contact-close.png` and `zoom/fcc-hull.png`: about 35% of the
     selected friendly frigate is covered in flat, saturated red-orange
     blotches.
   - At the same 3:00 beat in R2 (`R2-first-contact-close.png`) the hull is
     clean. Small red spots also appear on the frigate in
     `zoom/fbc-hull.png`.
   - Source: the damage branch in `src/render/materials.js:539`. The
     `core * dmg * flicker * 2.4` emissive in `uHotColour` covers large noise
     regions instead of cracks, and the dark scorch underneath is invisible
     next to it.
   - It reads as **lava camouflage or red paint**, not damage. It breaks §3.3
     colour discipline, and it **puts a friendly hull in the enemy's hue
     family**.
2. **The tick ladder created a new collision with combat language** (fix 3
   above). Orange ticks in the hostile hue, rendered as world geometry and
   blurred by depth of field, read as incoming fire.
3. **The production panel is drawn over the Mothership with no backing.**
   - `zoom/fbw-br.png` (3×): in `R3-fleet-battle-wide.png` the panel's glyphs
     and prices (475, 2600) sit directly on the capital hull's greebles and
     partly disappear into them.
   - §3.8 says the UI "sits on the void". Here it sits on a ship and loses.
4. **The close camera buries its subject.**
   - In `R3-fleet-battle-close.png` the frigate is about 280 px wide against a
     wall of same-value clay asteroids covering roughly 70% of the frame.
   - In `R3-engagement-close.png` it is about 330 px, again on a rock.
   - R2's close frames had open space around the hull.
   - Whether this is the harness or the focus camera, a game's focus move
     must not frame a hull against an occluder of equal value.
5. **The HUD's words, the HUD's numbers and the end screen disagree.**
   - At 3:00 the HUD reads "They hold the middle" (YOU 95 / THEM 100).
   - At 7:20 it reads "The middle is level", with YOU *rising* to 98 and THEM
     falling to 71. The briefing never says sovereignty can rise.
   - At 10:39 it reads "They hold the middle · your sovereignty is draining"
     (89 / 62).
   - **Seams read 0/6 in every frame**, yet at 12:34 the victory copy says "You
     held the contested seams until their sovereignty ran out".
   - The end screen's "Fleet remaining 38" is also hard to square with 17
     hulls at 10:39, when only 27 were commissioned in the whole match.
   - Either the end screen comes from a different run, or the counters and the
     copy are out of step. Either way, a stranger reading both screens is told
     two different stories. **Verify before treating this as a bug.**
6. **Not new, but unaddressed and now the loudest leftover:**
   - Uniform hairline tracers (R2 regression #5).
   - The production panel still shows no class names, build times or pop
     (R2 regression #4). The clipped price is fixed; the information is not.
     Round 1 had it (`round1/PLAY3-fleet-battle-wide.png`, lower right).

---

## Single biggest gap per frame

| Frame | Biggest gap |
|---|---|
| `R3-first-contact-wide` | The left half is orange tick confetti that reads as incoming fire, while the actual first contact is a knot of overlapping glyphs inside an asteroid cluster. |
| `R3-first-contact-close` | A friendly frigate splattered in saturated red emissive: it reads as enemy, or as lava. |
| `R3-engagement-wide` | Weapons fire is four uniform cyan hairlines that read as order lines, and the enemy capital reads as an oil platform. |
| `R3-engagement-close` | A dark hull on a dark rock of equal value. No rim light, so the silhouette depends entirely on the cyan trim. |
| `R3-fleet-battle-wide` | **There is no battle in the fleet-battle frame**: about 15 marks, no hull above 10 px except one under the HUD, and the fight hidden in rock. |
| `R3-fleet-battle-close` | The frigate is swallowed by a wall of clay asteroids covering about 70% of the frame. |
| `R3-endscreen-wide` / `-close` | A competent stat table over a blurred smear, with no image of what was won. The copy ("held the contested seams") contradicts every in-match frame. |
| `R3-title` | The hero ship is a flat vector delta-wing aircraft with hairline panelling, closer to an SR-71 than to anything in the game. The title promises a different art style from the one the game delivers. |
| `R3-briefing` | The strongest screen in the build: clear, well set, with an elegant seed sigil. Its gap is that it is three columns of prose with no image of your Mothership, which it describes as "the 1.9 km hull" without showing it. |
| `R3-paused` | Clean. The blurred Mothership backdrop works. The only tell is shared with the title: "BACK TO THE DEMO SHELF" on the title and "← DEMOS" in the HUD put the demo framing on screen. |

---

## Ranked fixes for round 4

1. **Re-art the damage state before anything else**
   (`src/render/materials.js`, damage branch at ~539).
   - Damage must read as dark first and hot second. Put scorch (albedo toward
     near-black, roughness up, trim emissive killed) on most of the damaged
     area.
   - Restrict hot metal to **thin crack lines**: ridged noise, e.g. a narrow
     `abs(n - 0.5)` band, not filled noise regions.
   - Cap the hot area at a few per cent of hull surface, and drop the 2.4 gain.
   - Move `uHotColour` off the hostile amber, toward a white-hot core with a
     dull ember edge.
   - Acceptance: a friendly at 20% hull still reads as *friendly* and as
     *damaged* at close range, and from three-quarters at 120 px.
2. **Make the capture boundary an overlay, not world geometry, and take it out
   of the hostile hue** (`src/render/environment.js`, `_buildSeams` and the
   tick shader around 1532–1915).
   - Exclude it from the depth-of-field and bloom passes.
   - Draw one continuous dashed hairline ellipse on the seam plane, with ticks
     of **constant screen length and constant orientation**: all perpendicular
     to the arc, never mixed radial and tangential.
   - Contested means desaturated bone. Ownership shows as a filled arc segment
     indicating hold progress, not as the whole ladder in team colour.
   - Never use the hostile mark's amber.
   - Acceptance: from the close camera, a stranger points at it and says
     "boundary", not "shots".
3. **Rebuild the weapon tracers** (`src/fx/weapons.js`). This was R2 regression
   #5 and it is still open.
   - Kinetic fire: a short bright head with a tapering, fading tail of about
     1/8 of the shot distance, not an endpoint-to-endpoint line.
   - Beams: core plus soft shell with width and brightness flicker.
   - Width attenuated by distance, so near fire is thick and far fire thin.
   - Friendly fire desaturated so it never reads as UI cyan.
   - Acceptance: in `engagement-wide`, nobody mistakes fire for an order line.
4. **Rim and fill light for hulls, plus occluder avoidance for the focus
   camera** (lighting in `src/render/materials.js` and
   `src/render/environment.js`; camera in `src/core/camera.js`).
   - Add the cold nebula rim that §3.2 already requires, a Fresnel-weighted
     edge term on the shadow side, so dark hulls separate from dark rocks and
     from the planet disc. Keep key:fill at 17.76:1 on the lit/shadow split;
     the rim is not fill.
   - Hulls against the planet get the rim plus atmospheric haze, not a flat
     black cut-out.
   - The focus camera should pick an approach angle with open space behind the
     hull, or fade occluding asteroids within N hull lengths.
5. **Fleet-range presence and mark grammar** (`src/fx/engines.js`,
   `src/ships/index.js`, `src/ui/select.js`).
   - Cap engine-glow intensity and size relative to hull screen size, so the
     engine is never wider than the hull.
   - Implement the render-side impostor floor that round 2 deferred, so a hull
     never drops below about 8–10 px of *hull*.
   - Unify hostile marks into **one shape family with class glyphs**, as
     friendlies have, once sensed. Add a one-line legend to the keys panel.
   - Give impact flashes a shape engines do not have, such as a short radial
     star or ring, so a hit and an engine are no longer the same smudge.
6. **Put the backdrop planet and ring at backdrop distance, and fix the planet's
   shading** (`src/render/skybox.js`, `src/render/environment.js`).
   - The ring must not parallax against the fleet camera, and no ship should
     ever sit *on* it. Either render it on the sky layer or place it at true
     distance with aerial haze.
   - On the gas giant: a penumbra band a few per cent of the radius wide; a
     night side that honours the contract (bands barely visible, not 40%); and
     a limb halo weighted by the light direction, strong on the lit limb and
     faint on the dark.
   - Make the asteroids obey the same key, so they have a shadow side.

**Process requirements for round 4's evidence.** These do not change the game,
but without them the next round cannot score fixes 2, 5 and 6:

- Two seeds at the same beat.
- A 13-class lineup at three-quarters.
- A 10-frame sequence of one capital death and one interceptor death.
- A close frame on a different class at each beat.
- A fleet-battle beat that actually contains a fight at load (≥60 hostiles
  engaged).

---

## Would a stranger believe this is a commercial game?

**No.** It is closer than round 2, and the menus (title, briefing, pause, end
screen) now **would** pass as commercial on their own. The briefing in
particular is genuinely good. What gives the build away now:

1. **The first time a friendly ship takes damage it turns red.** A saturated
   red-orange blotch pattern, on our side, in the enemy's hue family. No shipped
   game paints damage like this.
2. **Orange sticks everywhere that are not shots.** The capture ladder reads as
   weapons fire or debris, in the hostile colour, at every distance.
3. **Weapons fire that looks like a laser pointer.** Uniform hairlines from
   icon to icon.
4. **At the distance the game is played, you watch icons, not ships.** Hulls are
   white engine smudges or black stickers. The class silhouettes that fix 2
   built are only visible from the close camera, which then buries them in
   rock.
5. **The title art and the game art are two different products.** The title
   shows a sleek vector aircraft; the game shows greebled rods and bricks.

Round 3 removed the two loudest amateur signals from round 2, the plumes and the
shells, and did not add a regression of that size, apart from the damage
colour. That is real progress at the floor and none at the ceiling. To reach 6,
the build needs fixes 1–3 above: none of them is large, and all three are on
screen in the first three minutes.
