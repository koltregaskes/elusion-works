# Critic round 17: 24 criteria re-scored. Overall mean 6.28, no blockers, AAA verdict NO

**Why this round.** Round 16 left two blockers: C4 (hidden focus) and E1 (the economy). Since then these landed:
- #45: hidden focus. Space and Tab stay game keys, and Restart needs a second press.
- #46: group moves arrive together.
- #47: the economy is attackable.

This round re-scored everything those PRs could move, plus the session-shape and AI criteria the economy change could shift.

**Method.**
- Two fresh critics scored a frozen copy of `main` at `6837184`. Neither read `src/`.
- **Group A** used real keyboard and mouse input in Playwright. It covered C1, C4, C5, O1, O2, O3, R1, R2, R3, M2 and P2, plus a clean boot and the AAA verdict.
- **Group B** played about 150 matches and 170 staged fights in the plain-Node sim. It covered E1 to E4, A2 to A4, D1, D5 and T1 to T4.
- Every browser session had 0 console errors, 0 page errors and 0 failed requests.
- The raw reports, scripts and frames stay outside the repo.

## Scores

| Criterion | Before | R17 | Test | Reason |
|---|---|---|---|---|
| C1 | 4 | 6 | RUN | All six hidden-focus paths are fixed. The cursor was still a crosshair everywhere; #50 fixed that after this build. |
| C4 | 3 | **8** | RUN (touch rows not run) | All 38 keyboard and mouse rows of the controls card do what they say. Q and E work only while held. |
| C5 | 7 | 5 | RUN (stepped) | Focusing one interceptor and returning to the fleet takes 4 inputs. Follow loses a 540 m/s interceptor: it is off screen for 7 of 8 s. |
| O1 | 6 | 7 | PARTIAL | All 16 starting hulls are in the first frame. Select and move each advance the tutorial on the first natural input. Novice time was not measured. |
| O2 | 6 | 7 | RUN | Hints fire at the right moments, and the tutorial teaches one verb at a time. The briefing presents about 10 concepts. |
| O3 | 6 | 6 | PARTIAL / UNVERIFIED-LAPTOP | The fleet is named in the tutorial and codex, but not in the briefing. No commander persona was seen, and voice could not be heard. |
| R1 | 4 | 4 | PARTIAL | 6 of 13 classes were named in a shuffled close-up lineup. In a 400-hull fight, fighters are 1 to 3 px. |
| R2 | 5 | 5 | RUN (400 hulls) | The losing side was read 3 of 3 times; the nearest death 3 of 9, because overlapping bars hid dying hulls. #49 fixed that after this build. |
| R3 | 6 | 6 | RUN | 5 of 5 friendlies below 30% carry a red mark. One was half under the production panel. Shield is not told apart from armour. |
| M2 | 4 | **7** | PARTIAL | 195 of 200 hulls stopped within 93 to 187 s, with 0 more than 30 s after the median (round 16: 60 of 220). The "wall" stretched into a 20 × 9 × 10 km cloud. |
| P2 | 4 | 5 | RUN | 5 of 10 gameplay frames have a size reference. |
| E1 | 3 | **6** | RUN | Killing every collector at minute 10 cuts combat hulls finished by 48% over 0 to 180 s and 93% over 180 to 360 s. A real 24-bomber wing reaches only 11 of 62 collectors. |
| E2 | 6 | 6 | RUN | Upkeep, the population cap, sovereignty and the home defender's advantage all exist. Sides cut to 2:1 at minute 15 came back 0 of 8 times. |
| E3 | 5 | 5 | PARTIAL | Minute 5 differs from minute 20, but no match reached minute 40. #53 lengthened matches after this build. |
| E4 | 5 | 4 | RUN | Cruiser-only and destroyer-only spam lose 12 of 12. Bomber-only spam beats Even 10 of 12. |
| A2 | 5 | 6 | PARTIAL | The logs read as a plan: a raid at 1.3 to 2 min, then massing, a strike at 5 to 7 min, capitals at 13 to 22 min. It never answers bomber spam. |
| A3 | 4 | 4 | RUN | No personalities: the same first builds on every seed, and the first warship at 175 s every time. |
| A4 | 8 | 6 | RUN | Relentless beats Even only 11 of 24 (2 of 12 as blue). Cautious is described as "masses far too long" yet attacks first. |
| D1 | 7 | 7 | RUN (sim) | 12 of 13 stated counters hold at equal cost. The assault corvette still loses to almost everything. |
| D5 | 6 | 6 | PARTIAL | 32 bombers kill a cruiser in 34 to 44 s, just under the 45 to 90 s target. |
| T1 | 7 | 7 | PARTIAL / UNVERIFIED-LAPTOP | The player has 1,200 RU, an idle yard and a prompt at t=0. The first enemy raid lands at 76 to 122 s. |
| T2 | 6 | 5 | PARTIAL | Sovereignty swings in 28 of 62 matches, but all 62 end by sovereignty and 45 of 62 Motherships are never touched. |
| T3 | 6 | 5 | RUN | Matches run 12.8 to 32.2 min (median 20.1), so only 2 of 62 fall in the 30 to 60 window. |
| T4 | 5 | 4 | RUN | Play again replays the same seed, and a different match takes about 4 clicks. Seeds vary only the seam count. |

"Before" is round 16's score where it re-scored the criterion, otherwise round 15's.

**Clean boot (HANDOFF §6 item 1): PASSES.** Seeds 1, 7, 42, 13634, 31337 and 90210 each ran 600 extra ticks with 0 console, page or request errors.

## Claims checked before believing them

| Claim | Verdict |
|---|---|
| `tools/sim-test.mjs` builds only the amber AI, so "an AI-vs-AI match ends" is the AI beating an idle player (B) | **REAL, FIXED in #51.** `World` reads `{ seed, options }`, and sim-test passed `ai` and `pace` at the top level, where both were ignored. Round 15 ruled this same claim false; that ruling was wrong. Both AIs now run, and the fleet check counts each side separately. |
| Relentless beats Even only 2 of 12 as blue (B) | **REAL on `6837184`** (2 of 12 as blue, 9 of 12 as amber, on B's seeds). On current main, after #48, #52 and #55, Relentless beats Even 18 of 24 across 12 seeds with sides swapped. |
| Bomber-only spam beats Even 10 of 12 (B) | **REAL.** 9 of 12 on main after #48. #52 makes the AI answer bombers: now 7 of 12. Where spam still wins, it wins on sovereignty, out-holding the seams with cheap wings. |
| Esc, Tab, Space only arms Restart, and a second Space did not restart (A) | Arming confirmed. The second press restarted in our own run (CRITIQUE-ROUND-16 table), so the difference is likely focus after the label change. Not yet re-checked. |
| Group moves arrive together (A) | Confirmed: 0 of 200 arrived more than 30 s after the median. |

## Fixed since this build (not yet re-scored)

- **#48:** the assault corvette's guns are turreted. At equal cost it beats interceptors, bombers and scouts, and still loses to assault frigates (D1).
- **#49:** in a crowded fight the most damaged hull's bar is drawn on top, and overlapping bars stack (R2, R3).
- **#50:** the cursor shows what a right-click will do: a red reticle over a hostile, a cyan chevron elsewhere (C1).
- **#51:** sim-test runs a real two-AI match.
- **#52:** the AI answers a bomber fleet with flak and interceptors (E4, A4).
- **#53:** a standard match runs 30 to 60 minutes. The opening before the drain is 11 minutes, and Even against Even now runs a median 32 min with 9 of 12 in the window (T3, E3).
- **#54:** New universe on the end screen: one click to a fresh seed (T4).
- **#55:** enemy commander personalities (Raider, Warden, Swarm), choosable in setup or picked by the seed (A3), and an honest Cautious line (A4).

## Scoreboard after this round

The 24 criteria above use round 17's scores; the other 22 keep their earlier scores.

- **Overall mean:** 6.28 (was 6.11).
- **At 8 or more (8 of 46):** C2, C3, C4, C6, M4, A1, S4, P3.
- **Blockers (3 or below):** none, for the first time.

**AAA verdict: NO.** Critic A's three most damaging defects:
1. Big fights reduce the fleet to 2 to 4 px specks, so you cannot tell a ship's class or which ship is about to die.
2. Focus-follow cannot keep a fast ship on screen.
3. HUD layers cover the fight and each other: the tutorial card over the help card, the production panel over the densest fight, and clipped briefing buttons at 720p.

## Next fixes, ranked

1. **Small craft readable at combat distance (R1, R2, R3, P2).** A minimum on-screen size or a class glyph for fighters, and an "about to die" glyph.
2. **Focus-follow that keeps a fast hull in frame, and one "back to fleet" key (C5).**
3. **HUD layering (C4, R3, O1).** The help card above the tutorial card, markers clear of the production panel, and briefing buttons that fit at 1280×720.
4. **Seam control against strike-craft spam (E4).** Cheap wings out-hold the seams.
5. **Seeds that vary more than the seam count (T4, E3),** and a home seam far enough out for a raid to reach it (E1).
