# Critic round 1 — verdict and ranked fixes

A fresh-context art director reviewed nine frames: six from scripted play of a
real match (a fleet was built, ordered into combat, and won on sovereignty at
13:31) and three front-end screens.

**Verdict: 4/10. "Would a stranger believe this is a commercial game?" — No.**

**No blind A/B against Homeworld was performed.** Reference stills are
copyrighted and cannot be fetched, so the score is against `CRITIQUE-RUBRIC.md`,
against `ARCHITECTURE.md` §3, and against the reviewer's knowledge of the genre.
Nobody should quote this as a side-by-side result, because it isn't one.

## Scores

| Axis | Score |
|---|---|
| Art direction & composition | 4 |
| Hull design & silhouette | **3** |
| Materials & shading | 4 |
| Lighting & atmosphere | 5 |
| VFX (weapons, engines, explosions) | **3** |
| Environment (sky, nebula, asteroids) | 4 |
| UI/HUD typography & layout | 6 |
| Sense of scale | **3** |
| Readability in combat | **3** |
| Cohesion | 4 |

Four axes at 3. The rubric's own rule: *any criterion at ≤3 is a blocker — it
will define the player's whole impression regardless of the other numbers.*

## Does each implemented system actually register?

The most valuable half of the review. "Registers" means visible and
identifiable without being told it exists.

| System | Verdict |
|---|---|
| Greebled hulls, 13 per-class silhouettes | **No** — zero classes identifiable at play distance |
| Engine plumes, per-class colour | **No** — invisible at combat distance; registers once, on the victory screen |
| Weapon tracers, beams, missile trails | **Over-registers** — and is the worst-looking system in the build |
| Shield flashes vs hull explosions | **Partial** — cannot distinguish a shield hit from a hull hit in any frame |
| Nebula sky + resolvable stars | **Barely** — absent from most frames; reads as brown defocus blobs |
| Procedural asteroid fields | **Yes** — the strongest art in the build |
| ACES + bloom + TAA | **Registers as absence** — nothing clips, but nothing reaches highlight either |
| Logarithmic depth, 10⁵–10⁹ m | **Unused** — nothing in any frame is further than a few km |
| Selection brackets, order markers, seam indicators | **Mixed** — brackets over-register; **seam indicators do not exist in 3D at all** |
| Fleet HUD | **Yes** — strongest system overall |

Three claims were independently verified before this document was written:

- `_buildStar()` and `_buildPlanet()` **are** called (`environment.js:254-255`),
  yet appear in **zero of six** gameplay frames. Placement or camera
  constraint, not missing code.
- The contested seams have **no 3D representation whatsoever**. `environment.js`
  mentions them only in comments about rock budgets. The primary victory
  condition exists as ore rocks and the string `Seams 0/6`.
- There is **no match clock**. A `TIME` header sits over the speed controls with
  no elapsed time under it, while the briefing describes a timed grace period
  the player cannot measure.

## Ranked fixes

**1 · Rewrite the trail and tracer renderer.** Highest quality-per-effort in the
project. Trails: taper width to zero at the tail; three-stop colour gradient
(white-hot core → team hue → dark cool smoke); cut lifetime ~60%; per-trail
lateral jitter and per-missile launch spread so ribbons stop forming coplanar
sheets; cap concurrent trails. Tracers: 1 px hot core plus wider soft halo,
tapered head, distance falloff. Flares: replace the single 4-point sprite with
3–4 rotated, scale-varied variants. Until this lands every combat screenshot
reads as amateur regardless of what else is fixed.

**2 · Tier-2 masses and a prow on every hull ≥130 m.** The detail hierarchy is
missing its middle: there is the primary loft and greeble at 0.5–1% of hull
length, and nothing between. Add one or two secondary masses at 10–30% of
length using the existing `hangarBay()` / `truss()` / `radiator()`; an
asymmetric tapered prow that resolves heading from a static frame; a dorsal keel
line that survives at 100 px. Acceptance: render all 13 classes black-on-white
at 120 px and name them — target ≥10 of 13.

**3 · Give the contested seams volumetric presence.** A bounded field volume, a
colour that shifts with ownership, a boundary visible from across the map. Art
fix and design fix at once, and free spectacle: a contested seam glowing between
two fleets is the composition anchor every empty frame currently lacks.

**4 · Rebuild the nebula as foreground art.** 2–3 more octaves of filament
detail so edges resolve; a genuine rim where gas meets void; in-scattering from
the key-star direction so it has a lit and a shadow side; stars occluded by
dense regions. And guarantee at least one large composed gas form in the
standard combat camera's field of view.

**5 · Put the backdrop object in frame.** Cheapest fix on the list — the
geometry already exists. A planet subtending 20–40° behind the battle line fills
the dead canvas, establishes absolute scale, and gives every screenshot a focal
anchor.

**6 · Fix selection brackets and order markers.** Brackets are constant screen
size at any range, identical for all 13 classes, and drawn around sub-pixel
targets, which destroys depth perception. Scale to projected hull size with a
floor; use the `silhouette` path already in `catalog.js` as the long-range glyph
so class reads even when the mesh doesn't; suppress for sub-pixel and unengaged
units. Order lines need a directional taper and an arrival marker.

**7 · Collapse the production panel; re-home the stance/formation palette.** The
production panel is the largest element on screen in 5 of 6 frames, permanently
open, sitting on top of the combat. Collapse to a row of role glyphs with cost.
The palette floats unanchored in dead centre-bottom with illegible sub-6 px
keycaps — dock it to the selection roster. §3.8 says the UI "sits *on* the void,
never boxes it in"; a 470×340 always-on grid boxes it in.

**8 · Unify type and put art on the title screen.** The grotesque logotype is a
website headline fighting the mono hairline language used everywhere else.
Rebuild the title in the type the rest of the game already owns, and put
something in the frame — the pause-screen mothership beauty pass is better art
than anything currently on the title.

**Below the cut, cheap:** widen the value range so lit edges facing the key
approach white (everything lives in a ~15–120/255 band); break the asteroid
`sharedShape` reuse and add two more size classes; text scrim behind the top HUD
bar; add an actual match clock; check the `POPULATION` readout, which rendered
as `.18 / 55`.

## Capture defect to fix before round 2

`PLAY3-fleet-battle-close.png` was the victory screen, not a hull close-up, so
the fleet-battle beat has no close pass. `.local/play-capture.mjs` needs to
detect match end and recapture, or capture the close pass before the match can
resolve.
