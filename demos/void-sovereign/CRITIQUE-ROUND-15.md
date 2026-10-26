# Critic round 15: the first full-rubric baseline. Mean 5.6 across 46 criteria, 6 blockers, AAA verdict NO

**Why this round is different.** Rounds 1 to 14 scored the art axes and a handful of criteria (R2, R3, R5, P3). Phase 1 is only done when *every* criterion in `CRITIQUE-RUBRIC.md` §3 scores 8 or more (HANDOFF.md §6, item 4). So this round scored all 46, from scratch, against the rubric's own Test lines.

**Method.**
- Three fresh critics that had never seen the code worked in parallel:
  - A: readability, control and fleet management.
  - B: combat depth, economy, AI and session shape.
  - C: onboarding, audio, spectacle, the G1 to G17 gap list, the AAA verdict and the clean-boot check.
- They were forbidden from reading `src/`.
- Everything was headless: Chromium on SwiftShader with frames stepped at 1/60 s, plus the sim run in plain Node for B. B played 82 full AI-against-AI matches and about 300 staged fights.
- Each criterion is marked RUN, PARTIAL or UNVERIFIED-LAPTOP (needs a real GPU, real-time feel, a human player or hearing).
- Build scored: `main` at `59259df`. The raw reports, scripts and frames stay outside the repo.

## Scoreboard

| Section | Criteria (score) | Mean |
|---|---|---|
| 3.1 Readability | R1 4 · **R2 2** · **R3 3** · R4 7 · R5 6 | 4.4 |
| 3.2 Control and feel | **C1 3** · C2 9 · C3 8 · **C4 3** · C5 7 · C6 8 | 6.3 |
| 3.3 Fleet management | M1 6 · M2 4 · M3 7 · M4 8 · M5 7 | 6.4 |
| 3.4 Combat depth | D1 4 · D2 6 · D3 6 · D4 6 · D5 4 | 5.2 |
| 3.5 Economy and pacing | **E1 3** · E2 6 · E3 5 · E4 5 | 4.8 |
| 3.6 AI | A1 7 · A2 5 · A3 4 · A4 4 | 5.0 |
| 3.7 Onboarding | **O1 3** · O2 6 · O3 6 · O4 7 · O5 5 | 5.4 |
| 3.8 Audio | S1 6 · S2 6 · S3 6 · S4 8 | 6.5 |
| 3.9 Spectacle | P1 6 · P2 4 · P3 8 · P4 7 | 6.2 |
| 3.10 Session shape | T1 7 · T2 6 · T3 6 · T4 5 | 6.0 |

- **Overall mean:** 5.63.
- **Blockers (3 or below):** R2, R3, C1, C4, E1, O1.
- **At 8 or more (6 of 46):** C2, C3, C6, M4, S4, P3.
- **UNVERIFIED-LAPTOP, provisional scores:** S3, P1, T1 and T2. The feel half of C2 and C6 is also unverified.

**AAA verdict (critic C): NO.**

**Clean boot (HANDOFF §6 item 1): PASSES.**
- 11 seeds (1, 7, 37, 42, 99, 2718, 13634, 31337, kharak, 555, 90210), one browser at a time.
- 0 console, 0 page, 0 request and 0 load errors on every seed, including 900 extra ticks each.
- Every other session this round was also error-free.

## Claims checked before believing them

| Claim | Verdict |
|---|---|
| Right-click with ships selected orders an attack on your own Mothership (C, O1 blocker) | **REAL, FIXED in #40.** The enemy pick fell back to a ray test that ignored its `notTeam` filter. Seed 13634: 12 of 12 selected hulls before, 0 after. The sim now also turns a friendly attack order into guard. |
| Relentless is not harder than Even, and its setup line claims a bonus the sim never gives (B, A4 and A1) | **REAL, FIXED in #39.** Its 11 collectors over-spent the opening. At 8 it beats Even 21 of 24 (was 10 of 24) and Cautious 11 of 12, and Even still beats Cautious 12 of 12. The setup text now says what each level does. |
| `tools/sim-test.mjs` runs only one AI, so its "match ends" check is trivial (B) | **FALSE.** `makeWorld` passes `ai: { player: true }`, so both sides have a Commander. |
| Esc, Esc, Tab, Space restarts the match (A, C1 and C4 blockers) | Reproduced twice by A. Not yet checked by the integrator. Next fix. |
| The end screen shows fleet hull 100% against 100% (B, T3) | Not yet reproduced. The code reads the HUD's live figures, and B's session fast-forwarded the sim, which may have skipped the HUD's update beat. |

## Gap list G1 to G17 (critic C)

- **Fixed:** G1, G2, G3, G4, G8, G9, G11, G12, G13.
- **Partial:**
  - G5: tutorial steps 2, 5 and 10 misfire.
  - G6: right-click still depends on what is selected.
  - G10: veterancy only.
  - G14: no HUD scale.
  - G15: no colour-blind option.
  - G17: seeds vary only the contested seam count.
- **Open:**
  - G7: formations show no effect to the player, though B measured large real effects.
  - G16: 1,000-unit command was not run; 400 spawned cleanly.

## Ranked fix list (what moves the most criteria out of blocker range)

1. **Game keys always reach the game (C1, C4).** Hidden menu buttons must not take Space or Tab after the pause menu closes. Add a cursor that previews move, attack and orbit.
2. **Health bars that read in a big fight (R2, R3).** Show a side colour on each bar, draw bars above the effects, and pulse friendlies under 30%.
3. **The economy must be attackable (E1).** The AI banks 4k to 14k because production throughput, not money, is the limit. So a raid that cuts income 83% cuts its build only 12%.
4. **Counters true at equal cost (D1, D5, E4).** Bigger hulls win nearly every equal-cost pairing. The ion frigate loses to every class, and one cruiser beats 64 bombers.
5. **The opening (O1, P2, R1).** Start with the starting wing in frame, collapse the build panel and cut the briefing to three concepts. Put a size reference in every frame. Give fighters a minimum on-screen size.
6. **Formation moves arrive together (M2).** Fleets reach the destination up to 278 s apart, so make them wait for the slowest ship.
7. **Variety (A3, T4, E3).** Give the AI personalities separate from difficulty, add a one-click "New universe" on the end screen, and expose the longer pace.

## Fixes landed this round

- **#39:** Relentless is harder than Even, and the difficulty text is honest.
- **#40:** right-click never orders an attack on your own hull.
