# Critic round 16: targeted re-score of 11 criteria. Mean of the 11 up from 4.0 to 5.8, overall mean 6.11, AAA verdict NO

**Why this round.** Round 15 set the first full-rubric baseline. Since then six PRs landed:
- #39: honest difficulty, and Relentless is harder.
- #40: right-click on our own hull, and the pause menu no longer hands focus over.
- #41: health bars in side colour.
- #42: armour pierce, and counters that hold at equal cost.
- #43: big-fleet formations fit the map.
- #44: the opening frame.

This round re-scored only the criteria those PRs touched, plus M2 and the AAA verdict.

**Method.**
- One fresh critic, forbidden from reading `src/`, worked against `main` at `6e793fa` (before #44).
- Everything was headless: Chromium on SwiftShader with stepped frames, and the sim run in plain Node.
- Every browser and Node session had 0 console errors, 0 page errors and 0 failed requests.
- The raw report, scripts and frames stay outside the repo.

## Scores

| Criterion | R15 | R16 | Test | Reason |
|---|---|---|---|---|
| R2 | 2 | 5 | RUN | Bars show side colour. The losing side was read correctly 2 of 3 times, and the nearest death was named with the right side 4 of 9 times (was 0 of 9). Overlapping bars in a capital cluster hid two 8% destroyers. Fighters at wide framing show no health cue. |
| R3 | 3 | 6 | RUN | Red bars mark our hulls below a third. The critic listed 4 of 6 friendlies under 30% in 3 to 5 s on a paused frame. It missed fighters at wide framing and could not tell shield from armour. |
| C1 | 3 | 4 | RUN | The pause-menu exits are fixed. Space and Tab still changed meaning under hidden focus. The cursor is a crosshair everywhere. |
| C4 | 3 | 3 | RUN | All four ways out of the pause menu passed. But after H, H, Space did nothing. After two clicks on a HUD speed button, Space set x4, then muted the sound. In the open menu, Esc, Tab, Space restarted the match. **Fixed in this PR, not yet re-scored** (see below). |
| O1 | 3 | 6 | PARTIAL | The first right-click from the opening camera is a move: 16 of 16 hulls, 5 of 5 click points, including on the Mothership. 15 of 16 starting hulls were off screen at the first frame; #44, which landed after this build, puts 16 of 16 in frame. |
| D1 | 4 | 7 | RUN (sim) | Flak kills 3 to 13 of 20 interceptors, and the ion frigate kills 0. At equal cost, bombers and ion frigates now beat destroyers and cruisers. The assault corvette loses to almost every class. |
| D5 | 4 | 6 | PARTIAL | 32 bombers, about a cruiser's cost, kill the cruiser in 34 to 44 s, or fail with it at 4%. Most committed efforts land just under the 45 to 90 s window. |
| E4 | 5 | 6 | RUN | Cruiser-only spam won 4 of 16 against Even. Counter builds now beat cruisers at equal cost. |
| A1 | 7 | 9 | RUN | Relentless loads 320 RU at build rate 1.0, the same as the player. Cautious loads 288 RU at x0.85 build. The setup text says exactly that. |
| A4 | 4 | 8 | RUN | The text is honest. Relentless beats Even 18 of 24, Even beats Cautious 12 of 12, and Relentless beats Cautious 5 of 6. |
| M2 | 4 | 4 | RUN | One real-UI order to 220 hulls in wall formation, 21.5 km away. Arrivals ran from 36 to 314 s, and 60 of 220 arrived more than 30 s after the median. #43 fixed the formation's size, not its speed. |

## Claims checked before believing them

| Claim | Verdict |
|---|---|
| After H, H, Space does nothing, and Tab walks into the closed help card | **REAL, FIXED here.** The card kept focus on its close button through its 220 ms fade. Now the closed card is inert, and focus returns to where it was. After the fix, H, H, Space gives timeScale 0 with focus on the canvas. |
| After two clicks on HUD x2, Space sets x4 and then mutes | **REAL, FIXED here.** A mouse click left focus on the button. A pointer click now hands focus back to the view, while keyboard activation keeps its focus. After the fix, Space pauses, and Space again resumes at x2. Before, it resumed at x1, because the pause key did not hear the HUD's speed change. |
| Esc, Tab, Space in the open pause menu restarts the match | **REAL, FIXED here.** Restart match now arms on the first press ("Press again to restart"), disarms after 4 s or on leaving the menu, and restarts on the second press. |
| Fleets arrive piecemeal on a 220-hull order | Real and unchanged. The next fix. |

All four paths were re-run on this branch in one stepped browser session, with 0 errors.

## Scoreboard after this round

Scores for the 11 criteria are round 16's; the other 35 are round 15's.

- **Overall mean:** 6.11 (was 5.63).
- **At 8 or more (8 of 46):** C2, C3, C6, M4, S4, P3, A1, A4.
- **Blockers (3 or below):** C4 (fixed here, awaiting re-score) and E1.

**AAA verdict: NO.** The critic's three most damaging defects were:
1. Space and Tab taken over by hidden focus. Fixed here.
2. Fleets arriving piecemeal.
3. Big fights still turn to mush: overlapping bars, no health cue for fighters at wide zoom.

## Next fixes, ranked

1. **Group moves wait for the slowest hull (M2).** This also helps D5 and R2, since fleets would stop arriving one class at a time.
2. **The economy must be attackable (E1).** Still a blocker from round 15.
3. **Readable bars in clusters (R2, R3).** The lowest-health bar goes on top, fighters get a dying mark at every zoom, and shield shows distinctly.
4. **The assault corvette** loses at equal cost to nearly every class (D1).
