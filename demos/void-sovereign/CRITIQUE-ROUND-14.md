# Critic round 14: 5/10. Altitude now reads (R5 up to 6), and the close frames both sides; effects still print over the HUD, and the mid adds spacing, not size

**Method and limits.** As in rounds 12 and 13: headless SwiftShader in a cloud container with no
GPU, frames stepped at 1/60 s, and a fresh critic that had not seen the code. It scored against the
checklist, rubric sections 3.1 and 3.9, and round 13. It wrote its R2 and R5 answers before it
opened the key.

PREV is `e0329b8` (scored in round 13). NOW is `cc99f4b`: the HUD safe zone, hostile stalks and
the fleet gap label, seams kept, income per game second, wider bars and stronger prows.

The evidence is the played peak (the close now frames the tightest ours-against-theirs pair), the
staged altitude battle, the player hulls and the HUD crops. No blind A/B against Homeworld was run.

| Axis | R13 | **R14** | Why (frame) |
|---|---|---|---|
| Art direction & composition | 5 | **5** | `played-close-NOW` is the best composed frame so far, with one ship from each side. The mid is still specks on a dark field. |
| Hull design & silhouette | 6 | **6** | The stronger prows are close to invisible at this size. The mothership is still a box stack. |
| Materials & shading | 6 | **6** | No change. |
| Lighting & atmosphere | 6 | **6** | The hulls are still mostly on their shadow side. |
| VFX | 7 | **7** | Beams and spark storms read well, but they print over the HUD. |
| Environment | 6 | **6** | The rocks are still block lumps. |
| UI/HUD | 6 | **6** | Gains: the seams are back, and the top bar agrees with the production panel. Against that, sparks still cover "15 SELECTED". |
| Sense of scale | 5 | **5** | The close shows two bombers at hero size with no reference. |
| Readability in combat | 5 | **5** | The most damaged unit can be picked out on the wide. The mid shows 1 of 3 nearest-death bars. |
| Cohesion | 5 | **5** | Two hull languages. |
| **Overall** | **5** | **5** | Axis mean 5.7. Capped by art direction, scale and cohesion at 5, and by the stranger test. |

| Criterion | R13 | **R14** | Reason |
|---|---|---|---|
| R2 Combat legibility | 5 | **5** | On the wide, all 3 nearest-death units were named with the right sides, and the worst ranked first. On the mid, only 1 bar was visible: a hull under the top bar lost its mark to the HUD clip. The losing side still reads only from the HUD row. |
| R3 Health at a glance | 5 | **5** | No friendly was under 30%, so the test did not bite. |
| R5 Spatial comprehension | 4 | **6** | Read correctly: ours higher by 2.4 km, from "2.4 KM ABOVE HOSTILES", which matches the key exactly. **Against:** per-hull labels said +0.5 km beside it (one reference above the plane, the other above the hostiles), and the label was gone in m2. |
| P3 | 7 | **7** | Carried; not retested. |

## Per-change verdicts

1. **HUD safe zone and hint backing: PARTIAL.**
   - Marks are out of the panels, and the hint lines have a backing.
   - Canvas effects (sparks, tracers) are not clipped.
   - A hull under a panel loses its mark instead of having it pinned to the panel edge.
2. **Altitude between fleets: PARTIAL.** Correct, but contradicted by the per-hull labels, and
   placed far from the fleet.
3. **Seam count: VERIFIED.** The cost was the You / Them words.
4. **Income: PARTIAL.** Consistent, but "–" in every frame.
5. **Stronger prows: PARTIAL, close to not visible.**
6. **Hull bars: PARTIAL.** There is no visible empty track, so 89% and 94% look the same.
7. **Peak framing: PARTIAL.**
   - The close holds both sides: VERIFIED.
   - The mid spreads ships 1.9x wider, but their hulls stay about 10 px. P49's floor holds a fleet
     hull at 14 to 18 px however far away it is, so moving in does not grow it until it is past
     the floor.

## What the integrator checked and fixed after the critic (`3910c20`)

- **Altitude labels contradicted each other: REAL, FIXED.**
  - Per-hull labels now read relative to the hostiles nearest the selection, the same reference
    as the fleet label.
  - Both use medians. A mean had let one straggler 3 km up set the gap.
- **The fleet label was missing in m2 and far from the fleet: REAL, FIXED.**
  - It was placed by the selection's centroid, which can sit under the top bar, where the HUD clip
    hides it.
  - It now sits by the lowest on-screen selected hull, at the first of eight positions clear of
    every panel and hint line.
  - Measured: "2.9 km above hostiles" at m1 and "3.1 km above hostiles" at m2, both beside the
    fleet.
- **The HUD clip cut a whole left column: REAL, FIXED.** The clip had used the hint rail's box,
    and the rail is a full-height flex column. It now cuts round each hint line.
- **You / Them gone: REAL, FIXED.** The bars narrow twice before those words go. At 1280 px both
  they and the seam count stay (fit level 2, no overlaps).
- **Income "–": REAL, FIXED in code, UNVERIFIED in play.**
  - The rate is now a rolling 20 s of game time.
  - A 1.5 s window read nothing between collector loads.
  - The harness only draws about 2 s of frames after fast-forwarding, so it cannot show the rate.
- **Effects over HUD text: OPEN.** Sparks and tracers are drawn by WebGL under a DOM overlay. Masking
  them needs a render-side change (a panel mask in the composite pass), and that is a GPU-cost
  decision for the laptop.
- **The mid does not enlarge hulls: OPEN, and partly the harness.** The rig's mid is half the wide
  distance, and hulls under the P49 floor do not grow. A truer mid needs about a quarter of the
  distance, or a frame on a sub-cluster.

## Would a stranger believe this is commercial?

**No.** The first five things that break it, most damaging first:

1. The peak fight is about 25 hulls of 10 px, and the mid does not make them bigger.
2. Effects paint over HUD text.
3. Two hull languages, and a box-stack mothership.
4. Scale lies in the close, and the rocks are block lumps.
5. Altitude text contradicted itself. This one is fixed since.

## Top fixes for round 15

1. **Effects under the HUD.** Mask canvas FX out of the panel areas in the composite pass.
   - *Acceptance:* "15 SELECTED" holds 4.5:1 contrast on the battle frames.
2. **A mid that reads closer.**
   - *Acceptance:* the same barred hull is at least 1.5x its wide-frame length in the mid.
3. **Bars that rank and survive the HUD.** A visible empty track. Marks of hulls under a panel are
   pinned to its edge.
   - *Acceptance:* 3 of 3 nearest-death bars on the mid.
4. **Player kit cohesion with the bone hostiles.** This is the longest-standing cap on art direction
   and cohesion.
5. **The income rate shown in a played capture.** It needs more than 20 s of rendered play.
