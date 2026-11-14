# Critic round 19: 4 criteria re-scored. Overall mean 6.59, no blockers, AAA verdict NO

**Why this round.** Five PRs landed after round 18:
- #72 (another session): Warden commits like everyone else.
- #104: per-frame JavaScript in big fights. The impostor hook ran about 140 times a frame, and the spark field was asked for about 5,700 sparks a frame into 4,900 slots.
- #107: Relentless thinks every 0.4 s (was 0.65).
- #108: B returns to the fleet, F keeps your angle, and small craft are framed small.

This round re-scored the criteria those touched, plus a clean boot and a performance note.

**Method.**
- One fresh critic scored a frozen copy of `main` plus #108 at `165e5f9`, without reading `src/`.
- It played 160 Relentless-against-Even and 24 Even-against-Cautious matches in the plain-Node sim.
- It ran stepped browser sessions with real key presses, a 10-seed clean boot and a CPU profile of a 420-hull fight.
- Every browser session had 0 console errors, 0 page errors and 0 failed requests.

## Scores

| Criterion | R18 | R19 | Test | Reason |
|---|---|---|---|---|
| A4 | 5 | **6** | RUN (184 sims) | Chosen in the menu, and the copy is honest. Even beats Cautious 24 of 24. But Relentless beats Even only 107 of 160 (67%, 95% CI 59 to 74%), and 30 of 54 when both sides have the same personality. |
| C5 | 6 | **7** | RUN (stepped) | Fleet to one ship and back takes 3 inputs (click, F, B), down from 4. B kept the selection 4 of 4 times. Follow kept a 540 m/s interceptor on screen in 271 of 300 frames. |
| C1 | 7 | 7 | RUN (6 start angles) | F with nothing selected no longer flips: pitch held 6 of 6. Yaw still turned 15° in 2 of 6, beside asteroids. Following a moving ship changes your angle. |
| P2 | 5 | **6** | PARTIAL | A lone interceptor is 0.11 of the frame height, against 0.71 for a destroyer. But a 130 m frigate (0.77) was framed bigger than a destroyer and a 620 m cruiser (0.59). |

**Clean boot (HANDOFF §6 item 1): PASSES.** Seeds 3, 19, 77, 256, 1001, 4242, 13634, 31337, 65000 and 99999 each ran 600 extra ticks with 0 console, page or request errors.

**Performance note (not a score).**
- In a 420-hull fight, JavaScript self time per frame fell from 16.0 to 13.0 ms (two runs each, before #104 against after), about 19%. With garbage collection it fell from 17.8 to 14.3 ms.
- `src/ships/index.js` dropped out of the top ten, and `src/fx/index.js` fell from 1.3 to 0.7 ms.
- Real-hardware fps: UNVERIFIED-laptop.

## Claims checked before believing them

| Claim | Verdict |
|---|---|
| Relentless beats Even about 4 in 5 (#107) | **FALSE outside its tuning seeds.** 107 of 160 across seeds 25 to 56 and 101 to 112. The 39 of 48 behind #107 came from seeds 1 to 24, and 12-seed blocks swing 14 to 21 of 24. The integrator's own seeds 1 to 36 give 52 to 55 of 72 (72 to 76%). |
| B returns to the fleet, keeping angle and selection (#108) | **Partly true.** The selection was kept 4 of 4 times, the angle 3 of 4. One straggler 18 km out pushed the view to 16 km. **That straggler is fixed after this build** (below). |
| A lone interceptor is framed at about a tenth of the frame, a destroyer at about four tenths (#108) | **True for those two**, but a frigate was framed as big as a destroyer. **Fixed after this build** (below). |
| JS per frame dropped about a third (#104) | **Not reproduced: about a fifth.** The integrator's runs shared four cores with other sims, and its normalised figure overstated the cut. |
| The AI's retreat never fires (round 18, A2) | **FALSE, measured by the integrator.** It fires 27 to 35 times a match. But 54 of 68 retreating hulls die within a median 3 to 5 s, 12 to 14 km from home, and retreating at 60% hull does not change that. Damage lands too fast for a long trip home; that is combat pacing, not the retreat rule. |

## Fixed since this build (not yet re-scored)

- **#109: the AI builds capitals again.**
  - The round 17 bomber answer fired on almost every think, because ordinary fleets show a bomber share of 0.4 to 0.8. So the line never reached a capital. In Even against Even only 1 side in 6 built a destroyer, and treasuries sat on 7,000 credits.
  - Now 23 of 24 sides build a destroyer or cruiser.
  - Twelve Even-against-Even matches run 21.5 to 33.2 min, median about 28.5. All 12 still end by sovereignty, and no Mothership drops below 83% (T2).
- **#111: Even answers a bomber swarm with interceptors and corvettes.**
  - Bomber-only spam beat Even 20 of 24 on main. It now wins 10 of 24.
- **This PR: the focus size ladder and B.**
  - A lone hull now frames at 0.11 (interceptor), 0.16 (corvette), 0.26 (frigate), 0.42 (destroyer) and 0.58 (cruiser) of the frame height, by length.
  - B with an 18 km straggler frames the fleet at 2.6 km with 11 of 11 warships on screen.

## Scoreboard after this round

The 4 criteria above use round 19's scores; the other 42 keep their earlier scores.

- **Overall mean:** 6.59 (was 6.52).
- **At 8 or more (9 of 46):** C2, C3, C4, C6, M2, M4, A1, S4, P3.
- **Blockers:** none.
- **Lowest:** R1 4; D5, E3, O5 and T2 at 5.

**AAA verdict: NO.** The critic's three most damaging defects:
1. Relentless is not reliably harder than Even, and the personality pairing outweighs difficulty. A Relentless Warden loses to an Even Swarm 8 of 15.
2. Focus size stopped meaning ship size above corvettes. Fixed after this build.
3. The camera still turns on its own. F turned 15° in 2 of 6 starts, following drags the lens below the ship, and B framed stragglers (fixed after this build).

## Next fixes, ranked

1. **A second real ending (T2, T3).** Every match still ends by sovereignty, and Motherships are barely touched. Now that capitals exist, strikes on the Mothership should be a live threat.
2. **Relentless margin (A4).** Faster thinking is spent: 0.3 s gave 32 of 48 against 30 of 48 at 0.4. The next lever is play quality: target choice and when to commit.
3. **Strike craft readable at fight distance (R1, R2).**
4. **Combat pacing (A2, D5).** Hulls go from 60% to dead in about 6 s, so no retreat can work.
5. **Follow camera keeps its angle (C1).**
