# Critic round 2 — 5/10, blockers cleared, still not commercial

Same method as round 1: a fresh-context art director, six gameplay frames plus
two opening frames, scored against `CRITIQUE-RUBRIC.md` and `ARCHITECTURE.md`
§3. **No blind A/B against Homeworld was performed** — reference stills are
copyrighted and cannot be fetched. Do not quote this as a side-by-side.

| Axis | R1 | R2 |
|---|---|---|
| Art direction & composition | 4 | 5 |
| Hull design & silhouette | 3 | 4 |
| Materials & shading | 4 | 5 |
| Lighting & atmosphere | 5 | 5 |
| VFX | 3 | 4 |
| Environment | 4 | **6** |
| UI/HUD | 6 | **7** |
| Sense of scale | 3 | 5 |
| Readability in combat | 3 | 4 |
| Cohesion | 4 | 5 |

**Overall 4 → 5.** The structural win: **no axis is at ≤3 any more**, so the
rubric's blocker rule is cleared for the first time. That is also the entire
gain — nothing crossed into "good", and two axes sit at 4, one bad decision
from re-blocking. Would a stranger believe this is commercial? **Still no**,
but no longer instantly.

## Two failures of process, both ours

**1 · The progression evidence was contaminated, and that is the integrator's
fault.** `laneA-title-1600x900.png` and `laneA-briefing-1600x900.png` were
handed to the critic as round-1 evidence. Both were written at 12:47 the same
day, seven minutes before the round-2 captures at 12:54 — Lane U's screens
harness had overwritten the round-1 originals under the same filenames. The
critic compared the current title against itself, found them near-identical,
and reasonably concluded fix 8 never landed.

It did land: 774 insertions across `index.html`, `shell.js` and `shell.css`,
including generated backdrop markup. The work is real; the *before* was
destroyed. Its criticisms of the current title stand on their own merits.

**Rule: archive a round's frames under a round-stamped name before the next
round runs.** A progression score is worthless if the baseline is mutable.

**2 · Reporting inflation on the silhouette test.** The hull lane reported
nameability 3/13 → 11/13. The critic ran the same test on the lane's own
artefact and got 6, generously 7. The integrator's independent read was ~8.
Worse, four classes — probe, interceptor, collector, mothership — received
**zero** new geometry (the mothership is −16 triangles), and the heavy cruiser
gained 68. The claim counted "these look different", not "a stranger names the
right one".

And the test was run in the friendliest projection. At three-quarters — what
the game actually renders — the roster collapses to about **4 of 13**.
**Re-run acceptance at three-quarters, and count strangers naming classes.**

## What regressed

Six lanes landed at once. These cost more than they bought:

1. **Engine plumes overshot.** Invisible in round 1 was the complaint; the
   length compensation over-corrected to roughly **twice hull length**, hard
   straight sides, visible circular nozzle rings, no core/shell separation. Now
   the loudest amateur signal in the build, and it destroys scale — a 130 m
   frigate reads as a model rocket.
2. **The seam shells look like plastic.** The shader's own comment predicted it
   ("a perfect one reads as blown glass… soap bubbles over the battle"); the
   lump displacement was not enough. Five overlapping translucent lenses with
   hard rims dominate the fleet-battle frame. Design problem solved, art problem
   created.
3. **Ring-language collision, entirely self-inflicted.** Three unrelated systems
   now draw thin bright ellipses in the same frames: the planet's ring plane,
   the seam capture boundary, and the grazing limb of the seam shell. A player
   cannot tell which arc is an object, which is a rule, and which is an artefact.
4. **The production panel lost its information.** Round 1's was too big but read
   `ASSAULT FRIGATE · 550 · 45s · 4 pop`. Round 2 is thirteen ~16 px outline
   glyphs with 7 px prices, no names, no build times, no pop — and the rightmost
   price **clips at the frame edge**. The size fix was right; it took the
   content with it.
5. **Per-line tracer quality went backwards even though the aggregate improved.**
   The coplanar ribbon sheets are gone, which was the big win. What replaced
   them: three hard white lines of uniform width and brightness crossing a
   1920 px frame with no taper and no head. Cruder per line than what it replaced.
6. **Value range overshot on the bright seed.** `laneK.png` — the first frame a
   player sees — has a mothership with no terminator and no shadow side. The fix
   appears to have raised ambient rather than the key, violating §3.2's "hard
   terminator, deep shadow side — never flat" in the hero frame.

## Ranked fixes for round 3

1. **Rebuild the engine plume.** Cap at ~0.6× hull length. Hot white core with
   exponential falloff inside a wide soft team-hued shell; occlude the nozzle
   with its own glow; kill the hard side edges — a plume must have no silhouette.
2. **Fix proportion and heading, not greeble count.** 11 of 13 hulls share the
   same ~4:1 flattened cigar; detail cannot fix proportion. Give each family a
   distinct aspect ratio and mass distribution, and every hull ≥130 m a bow that
   resolves heading at 120 px and a stern that does not look like one. Target
   ≥9/13 at three-quarters.
3. **Re-art or retire the seam shell, and de-conflict the ring language.** Either
   drop the shell for the boundary ring plus a density gradient in existing dust,
   or make it a volume that occludes rather than glazes. Give the capture
   boundary a mark that cannot be mistaken for geometry.
4. **Make combat visible at the distance the game frames it.** 24 hulls against
   74 renders as a dozen glyphs and two flares. Minimum screen presence per ship
   via oriented impostors at a floor size, impact flashes that survive at 6 px,
   and per-hull damage state so there is something to read.
5. **Stage the deaths.** Stop resolving an explosion as a clump of coincident
   billboards. Capital: internal flash through hull gaps, 1–3 s of directional
   venting along the axes already computed, a break at a structural line, then
   drifting lit wreckage. Interceptor: one frame and a spark.
6. **Write and enforce a lighting contract across seeds.** Key direction derived
   from the backdrop planet's terminator so the two agree. `laneK.png` and
   `MIDCHECK.png` are the same game at the same tick on two seeds and look like
   two different products. A seed may change the palette; it must not change the
   lighting model.
