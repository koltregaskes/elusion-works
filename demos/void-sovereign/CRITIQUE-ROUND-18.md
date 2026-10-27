# Critic round 18: 20 criteria re-scored. Overall mean 6.52, no blockers, AAA verdict NO

**Why this round.** Eleven PRs landed after round 17's scored build:
- #48: a turreted corvette.
- #49: stacked health bars.
- #50: the right-click cursor.
- #51: a real two-AI sim-test.
- #52: the AI answers bombers.
- #53: 30-to-60-minute matches.
- #54: New universe.
- #55: personalities.
- #56: round 17 docs.
- #57: camera updates by frame.
- #58: HUD layering.

This round re-scored the criteria those PRs touched.

**Method.**
- Two fresh critics scored a frozen copy of `main` at `956a9f5`. Neither read `src/`.
- **Group A** used real keyboard and mouse input in Playwright. It covered C1, C4, C5, O1, O2, R2, R3, M2, P2 and D1, plus a clean boot and the AAA verdict.
- **Group B** played 112 full matches, 16 raid matches and 32 staged fights in the plain-Node sim, and used the real end screen in a browser. It covered E1, E3, E4, A2, A3, A4, D5, T2, T3 and T4.
- Both critics built both AIs by hand, with options passed inside `options`.
- A container restart stopped both critics mid-run. Both resumed and finished every planned run.
- Every browser session had 0 console errors, 0 page errors and 0 failed requests.

## Scores

| Criterion | R17 | R18 | Test | Reason |
|---|---|---|---|---|
| C1 | 6 | 7 | RUN | The cursor previews right-click: a red reticle over a hostile, a cyan chevron elsewhere. G has no preview, and F with nothing selected flips the camera under the fleet. |
| C4 | 8 | 8 | PARTIAL (touch rows not run) | All 34 keyboard and mouse rows of the controls card do what they say. Two quick Ctrl-clicks on one ship read as a double-click. |
| C5 | 5 | 6 | RUN (stepped) | Follow kept a 540 m/s interceptor on screen in 530 of 600 frames. Fleet to one ship and back still takes 4 inputs, and there is no "back to fleet" key. |
| O1 | 7 | 7 | PARTIAL | A real box-drag and right-click each advanced the tutorial on the first try. Take command to ready took 43.6 s on the software renderer. |
| O2 | 7 | 7 | RUN | One verb per tutorial step. The briefing still presents about 11 concepts before the first order. |
| R2 | 5 | 6 | RUN (400 hulls) | Nearest death named 6 of 9 times (was 3 of 9), and stacked bars hold. The top bar's fleet hull counts the whole map, not the fight. Fighters are 1 to 4 px. |
| R3 | 6 | 7 | RUN | All 5 friendlies below 30% carried a red-outlined bar, and all 5 were found. Shield is not drawn apart from armour. |
| M2 | 7 | **8** | RUN | 198 of 198 arrived after a 19 km wall move, none more than 30 s after the median, with 0 overlaps. |
| P2 | 5 | 5 | RUN | 6 of 10 gameplay frames carry a size reference. A focused interceptor fills the screen like a capital. |
| D1 | 7 | 7 | RUN (sim) | At equal cost the corvette beats bombers, scouts and missile corvettes 8 of 8, and interceptors 5 of 8. It loses to assault frigates 0 of 8. |
| E1 | 6 | 6 | RUN | Killing every collector at minute 10 cuts amber's combat builds 55% and then 73%, and its wins fall from 6 of 8 to 1 of 8. A real 24-bomber wing kills only 31 of 64 collectors, and they are rebuilt by minute 16. |
| E3 | 5 | 5 | PARTIAL | 9 of 72 matches reach about minute 40. The mix at minutes 5 and 20 is nearly the same. |
| E4 | 4 | **7** | RUN | Cruiser-only spam wins 0 of 8, destroyer-only 0 of 8, bomber-only 2 of 8. The AI answers bombers with 2 to 3 times more interceptors. |
| A2 | 6 | 6 | PARTIAL | The plan reads: harass, mass, then a 12-hull strike at about 174 s. But retreat issued 0 orders in 112 matches, and only 61 of 371 strikes carried a capital. |
| A3 | 4 | 6 | RUN | Personalities open differently on the same seed, but each opens identically on every seed. Warden's "capitals sooner" line is false. |
| A4 | 6 | 5 | RUN | Even beats Cautious 11 of 12 and Relentless beats Cautious 10 of 12. **Relentless beats Even only 6 of 12**, and on every seed the same side won whichever side was Relentless. |
| D5 | 6 | 5 | PARTIAL | 32 bombers kill a cruiser in 29 to 46 s. Cruisers appear in 42 of 112 matches, first at a median 18 min. |
| T2 | 5 | 5 | PARTIAL | All 112 matches end by sovereignty. No losing Mothership drops below 50%. |
| T3 | 5 | 6 | RUN | Even matches have a median 29.7 min, with 14 of 30 in the 30-to-60 window (round 17: 2 of 62). In 16 of 30 the result was settled more than 5 min before it was called. |
| T4 | 4 | 6 | RUN (browser) | New universe starts a fresh seed in one click. Seeds still vary only the seam count and the seed-picked personality. |

**Clean boot (HANDOFF §6 item 1): PASSES.** Seeds 1, 7, 42, 13634, 31337 and 90210 each ran 600 extra ticks with 0 console, page or request errors.

## Claims checked before believing them

| Claim | Verdict |
|---|---|
| Relentless beats Even 18 of 24 (integrator, round 17 notes) | **FALSE as a general claim.** Critic B's 12 matches were 6 of 12. Its log shows why: personalities are picked per side from the seed, so swapping difficulty keeps each side's personality, and the personality pairing decided every seed. In Even matches Warden wins 10 of 38, Swarm 18 of 24 and Raider 16 of 26. My 18 of 24 came from a seed set with fewer Wardens. The real defect is personality balance. |
| A standard match runs 30 to 60 min, median 32, 9 of 12 in the window (integrator) | **Partly true.** Critic B: median 29.7, 14 of 30 in the window, 0 over 60. |
| The end screen read "Fleet hull left You 100% · Them 100%" after a defeat (B) | Not yet checked. B's run had the game loop stopped, which may have skipped the HUD's update. Rounds 15 and 16 raised the same doubt. |
| Focus-follow keeps a fast hull in frame (integrator, #57) | **Holds.** On screen in 88% of frames, with the longest gap 0.58 s. |

## Scoreboard after this round

The 20 criteria above use round 18's scores; the other 26 keep their earlier scores.

- **Overall mean:** 6.52 (was 6.28).
- **At 8 or more (9 of 46):** C2, C3, C4, C6, M2, M4, A1, S4, P3.
- **Blockers:** none.
- **Lowest:** R1 4; A4, D5, E3, O5, P2 and T2 at 5.

**AAA verdict: NO.** Critic A's three most damaging defects:
1. Big fights cannot be read at fight distance. Fighters are 1 to 4 px, and the only "who is winning" number counts the whole map.
2. The camera's rough edges: 4 inputs to one ship and back, F with nothing selected flips under the fleet, and a focused fighter reads as a capital.
3. The first match is slow to reach: three menu screens, about 11 briefing concepts and a 44 s load.

## Next fixes, ranked

1. **Balance the personalities, then confirm Relentless beats Even at least 75% (A4, A3, T2).** Make Warden's and Swarm's setup lines true.
2. **A second real ending, and capitals that fight (T2, T3, E3, D5, A2).** Capitals in strikes, a retreat that fires, and a called result once the drain is locked.
3. **Strike craft readable at fight distance (R1, R2, P2).** A class glyph with a minimum size, and a strength bar for the framed fight.
4. **Camera finish (C5, P2, C1).** A "back to fleet" key, F with nothing selected keeping the angle, and a minimum focus distance.
5. **A lighter first match (O2, O1).** The briefing cut to its first-move column, with the ways a match ends taught in the tutorial.
