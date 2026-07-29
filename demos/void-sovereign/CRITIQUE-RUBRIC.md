# VOID SOVEREIGN — Critique Rubric

> **What this is.** `ARCHITECTURE.md` §3 defines the *visual* bar. This file defines the
> **gameplay, UX and feel** bar. It is the standard a critic agent scores the build against,
> and the standard implementers build to.
>
> **What it is grounded in.** Published criticism of real space RTS games — chiefly the
> Homeworld lineage — plus adjacent RTS craft and RTS design literature. Where five reviewers
> independently name the same fault, that fault is encoded here. Where a claim rests on a
> single opinion, it is marked as such. Sources are listed in §7.
>
> **How to use it.** §3 is the scored rubric; every criterion has a *test you can actually run*.
> §6 is the prioritised gap list for the current build and is the section to act on first.

---

## 1. Executive summary — the ten things that decide this genre

Ranked by how reliably they separate a revered space RTS from a forgotten one.

1. **Orders must be obeyed, visibly, immediately.** The single most repeated complaint about
   Homeworld 3 is that ships "feel sluggish to respond", that "commands [are] a bit inconsistent",
   and that automatic behaviours override what the player asked for. A fleet that argues with you
   is worse than a fleet with fewer options.

2. **One input, one meaning.** Homeworld 3's most-upvoted control complaints are about right-click
   doing two jobs — camera and orders — and about "dual-purpose hotkeys [feeling] unwieldy". The
   developers eventually shipped three rebindable control schemes as an apology. Mode-dependent
   inputs are a design debt that compounds.

3. **Units must have legible, non-overlapping roles.** The harshest Homeworld 3 review argues its
   rock-paper-scissors "balance system … is largely absent" and that "precious few units are
   properly good at their jobs". A roster where every ship is a slightly different DPS number is a
   roster with one unit in it.

4. **Readability under load, not under inspection.** Reviewers describe HW3's battles descending
   "into a bit of mush", and note that the arena scale forces you so far out that selecting ships
   becomes difficult. If the player cannot answer "am I winning this fight?" in one glance at
   combat distance, nothing else in the design matters.

5. **The AI must play, not cheat, and must lose gracefully.** Resource-cheating AI is one of the
   most durable complaints in the whole genre, across Empire Earth, SpellForce 3, C&C3 and
   StarCraft II. Players report it makes "trying to control the resource mines pointless". A
   handicapped-but-honest AI reads as a better opponent than a buffed one.

6. **Anti-snowball, or the match is decided at minute eight.** RTS economies are structurally
   self-reinforcing: the winner of a fight holds the ground and takes the resources. Every durable
   RTS installs a brake — Company of Heroes' upkeep and retreat, supply caps, victory points,
   non-linear army scaling. Without one, half the match is a formality.

7. **Feel is audio.** The classic RTS solution to latency is the acknowledgement bark: the
   "Yes, Sir!" plays the instant you click, and it "serves to hide latency and make the game feel
   more responsive". Homeworld's reputation rests substantially on Paul Ruskay's soundscape and
   the Adagio. A silent space RTS is a screensaver.

8. **Scale must be felt, not just rendered.** Battlefleet Gothic: Armada 2 was praised for
   "weighty, satisfying combat" and for showcasing "the enormity of the battles". Inertia,
   turn radius, the time a capital takes to bring a broadside to bear — that is where the
   fantasy lives. Homeworld 3 was faulted for the opposite: destroyers that "nose up real
   close to their targets, just trading fire".

9. **Onboarding is the genre's chronic wound.** Stardock's own postmortem names delayed
   gratification, an "unintuitive context", and near-zero skill transfer between RTS titles.
   Dave Pottinger, who built the Age of Empires UI, concedes no RTS has ever achieved a great
   UI because there is "simply too much information that you have to present". Assume every
   player is new. Most will be.

10. **A skirmish must have a shape.** Homeworld 3's skirmish drew the sharpest player anger:
    six maps, "small and claustrophobic", "too fast and kinda too shallow", with strategy reduced
    to "a spam stream". Void Sovereign is skirmish-only. There is nothing else to hide behind.

---

## 2. The Homeworld 3 post-mortem — our checklist of what not to do

**Why this case matters.** Homeworld 3 is the most informative failure available to us: made by
people who understood the lineage, technically accomplished, visually praised — and rejected by
its own audience. The critic/player split is the whole story.

| Signal | Value |
|---|---|
| Metacritic Metascore | **75** (41 critics, "generally favourable") |
| Metacritic user score | **3.0** (84 ratings, "generally unfavourable") |
| Steambase player score | **41 / 100** from 8,623 reviews ("Mixed") |
| Steam concurrent peak | ~9,153 (13 May 2024) |
| Retention | ~89.5% of players lost by late August 2024 |

*Caveat: the Metacritic user sample (84) is small and self-selecting; the Steambase figure (8,623)
is the sturdier number. Both point the same way. Live concurrent figures quoted in search results
were not independently verified and are not relied on here.*

The lesson is not "critics are wrong". It is that **the things critics score — visuals,
production, technical execution — are not the things that make people keep playing.** Void
Sovereign is currently strong on exactly the axis that scored 75 and weak on several axes that
scored 3.0.

### The fault list

**F1 · Contextual right-click that is not predictable.**
Reviewers: contextual right-click "isn't wholly predictable". Players: right-click serves both
camera rotation and unit orders, "causing problems when trying to move the camera and command
units simultaneously". *Avoid: any input whose meaning depends on hidden state.*

**F2 · Orders overridden by automatic behaviour.**
The developers' own 1.3 notes admit they had to eliminate "edge-case bugs allowing automatic
behaviors to override player commands", overhaul retaliation ranges, and refine attack styles.
One reviewer: units perform "automatic maneuvers" instead of continuing attacks; ships "forget
their formation" after docking. *Avoid: autonomy that outranks an explicit order.*

**F3 · Attack-move was missing at demo, and had to be restored.**
Listed as one of five headline changes made from player feedback: "The classic attack-move
mechanic was restored." A genre-standard verb was absent, and its absence alone generated a
feedback campaign. *Avoid: shipping without the standard order verbs.*

**F4 · Collapsed rock-paper-scissors.**
"Each particular ship type excels at defeating one ship class" in earlier games; in HW3 that
differentiation "has collapsed". Railgun corvettes "stop dead when they fire", nullifying the
speed that justified them. Capitals refuse to kite. Strike craft were so weak the developers
buffed bomber health, speed, cooldown and missile damage, and nerfed everything that shot at
them. *Avoid: counters that exist in the stat table but not in observed behaviour.*

**F5 · Thin roster.**
Roughly 10 combat vessels per faction plus two turrets, widely described as too few with
"uninteresting ship designs". *Note: our 13 classes is comparable — so the roster must earn
its variety through role clarity, not count.*

**F6 · Depth systems deleted.**
Removed versus predecessors: modular capital-ship subsystem targeting, behaviour/stance orders,
veterancy bonuses, power-shunting trade-offs. Formation *bonuses* had already gone in Homeworld 2
— in HW1, aggressive stance gave fighters roughly +30% damage and +35% range, evasive traded
damage for survival, and passive broke formation to dogfight. These systems are why HW1 is still
discussed. *Avoid: formations and stances that are decoration.*

**F7 · Terrain/cover that does not pay.**
Cover is "more incidental in practice"; opportunities are "relatively scarce"; the larger the
fleet the less practical cover becomes; terrain obstacles are "mostly for show" and exploiting
them is "just not worth the hassle". Worse, ships got stuck on terrain or flew the wrong side of
it, breaking formations. *Avoid: a headline mechanic with no reliable payoff. Either make it
matter or cut it.*

**F8 · Cramped maps, no exploration.**
Skirmish shipped with six maps, "small and claustrophobic", "so cramped that everything becomes a
furball right on each other's doorstep", against a series whose maps "were so large that you could
get lost in them". One player: "with absolutely zero exploration it loses all its depth."
*Avoid: shrinking the void. The void is the product.*

**F9 · Neutered economy.**
Resources scattered everywhere with instant collection removed the tension of positioning
harvesters and the possibility of economic warfare. *Avoid: an economy you cannot attack.*

**F10 · Fleet management that does not scale.**
"Wrangling fleet groups is unwieldy"; command-group setup is difficult; the arena scale forces a
zoom level at which multi-select is hard. One reviewer's line is the whole thesis: *"I'm not
interested in controlling a 220-vessel fleet if it means hand-holding every ship all the time."*
*Avoid: a unit cap your UI cannot actually command.*

**F11 · HUD that eats the screen.**
"Very cluttered with things haphazardly placed"; a HUD scale slider had to be added post-hoc.
*We are in good shape here — DESIGN.md's hairline overlay is the correct instinct. Do not regress.*

**F12 · War Games: a good idea executed thinly.**
Praised as a genuine roguelike loop, then faulted: missions "aren't especially deep (go here, hold
this point, defend this NPC vessel)"; "limited options, variations, level types"; objective count
per mission was later doubled in response. *Relevant to us: a procedural mode is only as good as
its objective variety.*

**F13 · Story that could not be patched.**
The most-cited user complaint, and structurally instructive: "Negative reviews stem from both the
experience during gameplay and from the story itself, with the latter being unable to be patched."
*We have no campaign, so we have no exposure here — but we also have no narrative to carry a weak
match. See §4.*

### The counter-example: Deserts of Kharak

Widely regarded as the successful entry, and the reasons are consistent across reviews: it
**preserved the series' interface DNA** (tactical map, at-a-glance icons), it found "the same
stark beauty" in a new setting rather than imitating the old one, it made battles "more dynamic
despite being smaller in scale", and it was "approachable yet satisfying". The pattern: *keep the
signature interface, reduce scope, raise clarity.* That is precisely the brief for a browser demo.

---

## 3. Scored rubric

Score each criterion 0–10. Category score is the mean. Any criterion at ≤3 is a **blocker** —
it will define the player's whole impression regardless of the other numbers.

---

### 3.1 Readability & Clarity

**R1 · Silhouette identification**
- **10** — Every class is identifiable by black silhouette alone at combat distance, no colour, no
  label. A bomber cannot be mistaken for an interceptor. Names reinforce shape.
- **5** — Identifiable when zoomed in or by HUD icon; classes within a family blur together.
- **Failure mode named** — *"forcing players to zoom in to distinguish units"* (Act of Aggression,
  cited as the negative example in RTS unit-design literature); HW3's "uninteresting ship designs".
- **Test** — Screenshot the fleet at typical engagement distance. Convert to pure black on white.
  Show it to someone who has not played. Ask them to point at the bomber. Repeat for all 13 classes;
  target ≥10 correct.

**R2 · Combat legibility under load**
- **10** — With 400+ units engaged, the player can answer *who is winning, what is shooting what,
  what is about to die* within one second, without pausing.
- **5** — Legible when fights are small; degrades into light-show at scale.
- **Failure mode named** — battles that "descend into a bit of mush"; unit overlays creating visual
  confusion (HW3).
- **Test** — Record 20 s of a 400-unit engagement. Pause at three random frames. For each, name the
  losing side and the three units nearest death. Score 0 if you must open the sensors view to answer.

**R3 · Health and threat state at a glance**
- **10** — Damage state is readable on the hull *and* in the overlay; a ship at 20% looks like it.
  Shields read differently from armour.
- **5** — Bars exist but only on selection or hover.
- **Failure mode named** — Pottinger's rule: players must not "study unit animations" to assess
  health; hit-point bars exist because strategy needs "critical info via a split second glance".
- **Test** — Pause mid-fight. Without selecting anything, list every friendly below 30% hull.
  Time it. Target under 3 s.

**R4 · Role communication**
- **10** — The player can state what each class counters and what counters it, from in-game
  information only, within their first match.
- **5** — The data exists in code; the player must infer it from losses.
- **Failure mode named** — unit-design literature requires every unit answer "what does it do
  well?", and tooltips that state role, numbers, and the counter-intuitive weakness.
- **Test** — Give a new player 10 minutes. Ask them to name the counter to a bomber wing. If they
  cannot, the game has not told them.

**R5 · Spatial comprehension in three dimensions**
- **10** — The player always knows the altitude relationship between two fleets: stalks, shadows,
  grid, horizon ticks.
- **5** — Altitude is knowable by orbiting the camera.
- **Failure mode named** — "modelling a battlespace in which every individual unit has full six
  degrees of movement is difficult, and Homeworld 3 is evidence that it's still not a solved
  problem"; units "get confused and move too close or far to the designated location".
- **Test** — Order a wing to a point 3 km above an enemy. Without rotating the camera, state which
  fleet is higher. If you must orbit, score ≤5.

---

### 3.2 Control & Feel

**C1 · Input determinism**
- **10** — Every button does exactly one thing, always. No verb changes meaning based on selection
  state, camera state or hover target that is not explicitly previewed on the cursor.
- **5** — Mostly consistent; one or two context-sensitive verbs with a visible cursor preview.
- **Failure mode named** — HW3: right-click serving both camera and orders; contextual right-click
  that "isn't wholly predictable"; "dual-purpose hotkeys feel unwieldy"; "Absolutely TERRIBLE
  control scheme" thread titles.
- **Test** — Write down every mouse and key binding and the condition under which its meaning
  changes. Any binding with more than one meaning and no on-cursor preview loses a point.

**C2 · Order latency and acknowledgement**
- **10** — Visible acknowledgement within one frame of the click — cursor flash, marker, hull
  flicker, audio bark — even if the sim will not act until the next tick. Ships begin to turn
  within 100 ms.
- **5** — Ships eventually move; feedback is the movement itself.
- **Failure mode named** — HW3 "units feel sluggish to respond"; the classic mitigation is the
  acknowledgement bark, which "serves to hide latency and make the game feel more responsive".
- **Evidence note** — HCI work puts the mouse-interaction perception threshold around 85–100 ms,
  with 20–40 ms effectively imperceptible; sub-50 ms is generally imperceptible for
  press-then-observe tasks. Our sim ticks at 30 Hz (33 ms), so the *simulation* is inside the
  window — the risk is entirely in feedback, not in the tick rate. *The RTS-specific latency study
  (Claypool) could not be retrieved directly; the thresholds above come from general
  mouse-interaction HCI literature and should be treated as indicative.*
- **Test** — Screen-record at 60 fps. Count frames between mouse-down and the first pixel that
  changes as a result. Target ≤2 frames for acknowledgement, ≤6 for visible hull rotation.

**C3 · The order verbs are complete**
- **10** — Move, attack, **attack-move**, guard/escort, stop/hold, patrol, queue, formation, stance.
  All bindable, all discoverable.
- **5** — Move and attack only; the rest inferred from stance.
- **Failure mode named** — HW3 shipped without attack-move and had to restore it as one of five
  headline feedback changes.
- **Test** — Attempt to order a fleet to advance across the map engaging anything it meets, without
  micromanaging. If you cannot, C3 ≤4.

**C4 · Promises kept**
- **10** — Every control listed in the help panel does what it says.
- **5** — One documented control is a no-op.
- **Failure mode named** — this is self-inflicted; nothing erodes trust faster than a help screen
  that lies.
- **Test** — Walk the entire help panel, row by row, and exercise each binding. Any row that does
  nothing is an automatic **blocker**.

**C5 · Camera**
- **10** — Orbit, zoom, pan and focus are on separate inputs, never fight the order system, and
  never lose the fleet. Zoom is exponential. Focus-follow tracks a moving group.
- **5** — Works, but shares an input with orders or overshoots at scale.
- **Failure mode named** — "The camera control is just god awful"; "the CAMERA makes me sick";
  camera "wigging out" in tight spaces; "the camera makes it difficult to give precise movement
  directions in the thick of battle".
- **Test** — From a full-fleet view, focus a single interceptor and return to fleet view in under
  three inputs. Then do it while the interceptor is moving at full speed.

**C6 · Weight and inertia**
- **10** — A 1,900 m mothership and a 14 m interceptor obey visibly different physics. Capitals
  bank, overshoot, take seconds to reverse. Nothing pivots on the spot.
- **5** — Different speed values, same handling character.
- **Failure mode named** — BFG:A2 was praised precisely for "weighty, satisfying combat"; HW3 was
  faulted for capitals that abandon standoff range and just trade fire nose-to-nose.
- **Test** — Order a destroyer to reverse course. Time it. If under 4 s at 380 m length, the mass
  is not being felt. Then order an interceptor to do the same; it should be near-instant.

---

### 3.3 Fleet Management at Scale

**M1 · Selection at scale**
- **10** — Band-select, double-click-type, control groups, select-all-of-role, select-subgroup, and
  a roster you can click. All work at full zoom-out.
- **5** — Band-select and control groups only.
- **Failure mode named** — "the sheer size of the arenas means you're often zoomed far out, making
  it difficult to manage your ships and select multiple crafts"; "wrangling fleet groups is
  unwieldy". Counterpoint from Pottinger: a *select-all* button so convenient that it "eclipsed
  intentional unit differentiation" is also a failure — convenience must not erase the roster.
- **Test** — With 300 units in three engagements, select every bomber not currently in combat.
  Target under 5 s.

**M2 · Command scaling**
- **10** — One order to 200 ships produces coherent group behaviour: they arrive together, hold
  shape, and do not clump or collide.
- **5** — They arrive; the formation is approximate; capitals shoulder fighters aside.
- **Failure mode named** — ships "forget their formation" after docking; groups "drift to meet
  enemies at identical altitudes, despite positioning advantages"; the 220-vessel hand-holding
  complaint.
- **Test** — Select 200 mixed units, order a move 20 km away in wall formation. Watch the whole
  transit. Count collisions and stragglers. Any ship still in transit 30 s after the main body
  arrives is a failure.

**M3 · Fleet state summary**
- **10** — At any moment the player can see fleet composition, total value, population headroom,
  and what is under attack — without leaving the tactical view.
- **5** — Numbers exist but require the sensors view or a menu.
- **Failure mode named** — the genre-wide "too much information" problem; the fix is a persistent,
  glanceable summary rather than a drill-down.
- **Test** — Mid-match, without pausing or opening any panel, state your fleet's composition by
  role and whether anything of yours is currently taking fire.

**M4 · Order queueing**
- **10** — Shift-queue works for move, attack and harvest; queued waypoints are drawn; the queue
  survives combat interruption.
- **5** — Queueing exists for move only.
- **Failure mode named** — see C4. A queue that is advertised and silently discarded is worse than
  no queue.
- **Test** — Shift-click three waypoints then an enemy. The ship should visit all three and then
  attack. Watch it. Also confirm the path is drawn.

**M5 · Sensors / tactical view**
- **10** — A full 3D strategic overview showing own ships, detected enemies and resources, in which
  you can select and order. Toggling is instant and does not lose your place.
- **5** — A view-only overview.
- **Praise pattern** — Homeworld's Sensor Manager is the series' most-cited interface innovation:
  it "shows clearly where your ships, detected enemies, and asteroids are located in 3D", you can
  rotate freely, and you can *select ships and order them from within it*. Ordering from the
  sensors view is the part people remember.
- **Test** — Open the sensors view during a fight, retreat a wounded frigate to the mothership, and
  close it. If any step required leaving the view, score ≤6.

---

### 3.4 Combat Depth

**D1 · Counters are observable**
- **10** — The player can *see* rock-paper-scissors happening: flak visibly shreds fighters, ion
  visibly fails against them. The behaviour matches the affinity table.
- **5** — The table is correct; the on-screen result is ambiguous.
- **Failure mode named** — HW3's collapsed differentiation; "unit spam over rock paper scissors
  meta mechanics".
- **Test** — Run 20 interceptors into one assault frigate, then 20 into one ion frigate. The
  outcomes must be *obviously* different to a spectator who does not know the stats.

**D2 · Positioning matters**
- **10** — Facing, range band, altitude and concentration change outcomes measurably. Kiting works.
  Broadsides beat bow-on. A concave beats a blob.
- **5** — Only unit count and composition decide fights.
- **Failure mode named** — HW3 capitals that "nose up real close to their targets, just trading
  fire" instead of exploiting range; groups meeting "at identical altitudes, despite positioning
  advantages". Positive: StarCraft II's non-linear army scaling — Stalkers needing concave
  positioning, Siege Tank placement outweighing blob size — is cited as an intrinsic anti-snowball
  mechanism.
- **Test** — Same two fleets, twice: once head-on, once with one side pre-positioned above and
  behind. If the outcome margin does not move by ≥25%, positioning is cosmetic.

**D3 · Formations and stances are mechanical**
- **10** — Formations and stances alter damage, accuracy, survivability or engagement range, and
  the HUD says by how much.
- **5** — Stances alter behaviour; formations are geometry only.
- **Failure mode named** — HW1 gave aggressive fighters roughly +30% damage and +35% range;
  evasive traded offence for survival; passive broke formation to dogfight. Formation bonuses were
  removed in HW2, and behaviour orders removed entirely in HW3 — both are named as losses.
- **Test** — Fight the same engagement in delta/aggressive and in sphere/evasive. If the result is
  within noise, this scores ≤4.

**D4 · Meaningful attrition**
- **10** — Damaged ships remain useful, can be withdrawn, repaired, and carry visible history.
  Losing a fight is not the same as losing an army.
- **5** — Ships are binary: alive or dead.
- **Failure mode named** — veterancy bonuses removed in HW3 is on the deleted-depth list; Company
  of Heroes' retreat mechanic is repeatedly cited as the best-in-class anti-snowball tool
  precisely because "players can lose battles without having their forces annihilated".
- **Test** — Lose a major engagement deliberately. Can you extract a third of the fleet and get
  back in the match? If a lost fight is always a lost army, score ≤4.

**D5 · Capital ships feel like events**
- **10** — A cruiser arriving changes the whole engagement, is visible from across the map, and
  takes a coordinated effort to kill.
- **5** — It has more hit points.
- **Test** — Time-to-kill for a heavy cruiser under focused bomber assault should be long enough to
  respond to (target: 45–90 s of committed effort) and its death should be a set-piece.

---

### 3.5 Economy & Pacing

**E1 · The economy is attackable**
- **10** — Harvesters are exposed, worth raiding, and defending them is a real decision. Losing your
  collectors hurts within 60 s.
- **5** — Resources accrue; raiding is possible but never decisive.
- **Failure mode named** — HW3 "eliminates tension by scattering resources everywhere with instant
  collection, eliminating economic warfare possibilities". Positive: HW3's own AI-facing fix made
  Resource Controllers free but slower, to stop resource loss ending runs outright.
- **Test** — Kill every enemy collector at minute 10 with a bomber wing. Measure the enemy's build
  rate over the next three minutes. If it does not visibly drop, E1 ≤3.

**E2 · Anti-snowball brake**
- **10** — At least two of: upkeep/diminishing income with fleet size, population caps that force
  replacement rather than accumulation, defender's advantage near home, an alternative victory
  condition, retreat that preserves force.
- **5** — Population cap only.
- **Failure mode named** — "nobody enjoys being set back by a small margin and being destined to
  gradually lose". The literature's preference is for *subtle, passive* brakes — CoH's upkeep and
  supply-depot pacing — over punitive ones like WarCraft 3's sharp upkeep thresholds, which "feel
  punitive".
- **Test** — Give one side a 2:1 fleet advantage at minute 15. Can the losing side still win?
  If never, install a brake.

**E3 · Opening, middle and end game are distinguishable**
- **10** — Minute 5, minute 20 and minute 40 involve different decisions, different units and a
  different tempo.
- **5** — Same loop throughout, larger numbers.
- **Failure mode named** — HW3 skirmish "too fast and kinda too shallow"; strategy reduced to
  "research new classes as quickly as possible, and then cycle everything into a spam stream".
  Conversely Sins II is faulted because "the cool moments land at least an hour into a game" —
  both ends of the same axis.
- **Test** — Write down the three decisions you made at minute 5, 20 and 40. If they are the same
  three decisions, score ≤4.

**E4 · Production is a decision, not a rhythm**
- **10** — There is a real cost to building the wrong thing; the counter-build matters; you cannot
  win by queueing the most expensive hull on loop.
- **5** — Best-unit spam is viable but slower than playing well.
- **Failure mode named** — "unit spam over rock paper scissors meta mechanics"; Sins II's economy
  criticised as "upgrade and forget".
- **Test** — Play a match building nothing but cruisers. If you win at normal difficulty, E4 ≤3.

---

### 3.6 AI Quality

**A1 · Honesty**
- **10** — The AI plays the same economy under the same rules; difficulty changes decision quality,
  aggression, reaction time and APM — not income.
- **5** — Small income multipliers on higher difficulties, disclosed.
- **Failure mode named** — the single most durable AI complaint in the genre: "the AI never runs
  out of resources"; "the AI cheats by either building things much faster or collecting much more
  resources, which makes the enjoyment and thrill of trying to control the resource mines
  pointless".
- **Test** — Instrument enemy income and compare with the player's under identical conditions.
  Any undisclosed multiplier is a fail. If you must handicap, handicap *downward* on easy rather
  than upward on hard.

**A2 · Legibility of intent**
- **10** — The AI's plan is readable in hindsight: it massed, it flanked, it raided your economy,
  it pulled wounded ships out. The player can narrate the match afterwards.
- **5** — It attacks periodically.
- **Praise pattern** — the three behaviours that most reliably make an AI read as a player are
  early economic harassment, massing before committing, and withdrawing damaged capitals.
- **Test** — Play a match, then write a three-sentence account of what the enemy was trying to do.
  If you cannot, A2 ≤4.

**A3 · Variety across matches**
- **10** — Distinct AI personalities with different unit preferences and timings; two matches on
  the same seed against different personalities play differently.
- **5** — One behaviour tree with randomised timings.
- **Failure mode named** — HW3 shipped with AI that "lacked variety and challenge"; the fix was
  AI Personas (Sentinel, Swarm) "with distinct unit preferences".
- **Test** — Play three matches at the same difficulty. If the enemy's opening is the same every
  time, A3 ≤5.

**A4 · Difficulty that is choosable and honest about itself**
- **10** — Selectable before the match, described in plain language (not "Hard" but "reacts faster,
  raids earlier, does not make mistakes"), changeable without editing a URL.
- **5** — Selectable but unlabelled.
- **Failure mode named** — HW2's rubber-band scaling is the cautionary case: calibrated to
  professional-level play, uncapped enemy fleets against a capped player fleet, "explicitly
  punishing a player for doing too well". *Never scale difficulty to punish success.*
- **Test** — Can a first-time player choose an easier opponent without leaving the page? If not,
  A4 ≤3.

---

### 3.7 Onboarding & Accessibility

**O1 · First 60 seconds**
- **10** — Within a minute of the first frame, a total novice has selected something, moved it, and
  understood the goal — without reading anything.
- **5** — They can move the camera and are hunting for what to do.
- **Failure mode named** — "when new players open the tutorial and see 15 hotkeys, they will
  quickly close the game"; information overload leaves players "not knowing what to do or how to
  interact with features".
- **Test** — Hand the build to someone who has never played an RTS. Say nothing. Start a timer.
  Record the time to first successful move order. Target under 60 s. This is the single most
  informative test in this document.

**O2 · Progressive disclosure**
- **10** — Controls are taught as they become relevant: formation hints when a large group is first
  selected, stance hints on first combat, build hints on first surplus.
- **5** — A single reference panel behind a key.
- **Failure mode named** — the recommended fix is explicitly "slowly feed players the right
  information at the right time" rather than dumping the scheme.
- **Test** — Count the number of distinct concepts presented before the player's first order.
  Target ≤3.

**O3 · Anchoring the player**
- **10** — The player knows who they are and why they are looking at space from outside. A named
  command identity, a voice, a framing.
- **5** — An abstract cursor over a battlefield.
- **Failure mode named** — Stardock names "unintuitive context" — the overhead perspective and
  simultaneous unit control are "weird and contrived" to newcomers — and "limited player
  anchoring", where "absent narrative identity prevents newcomers from connecting emotionally".
  Their proposed fixes are commander personification and contextual framing (war table, radio
  operator).
- **Test** — Ask a new player, after ten minutes, "who are you in this game?" A blank answer is
  a fail.

**O4 · Reduced-input viability**
- **10** — The game is winnable at low APM. Tactical pause with order issuing. Speed controls.
  Nothing requires a click within a 200 ms window.
- **5** — Playable but rewards speed heavily.
- **Praise pattern** — HW3's tactical pause and time dilation were among the few mechanics
  reviewers consistently praised. Pottinger's warning applies: do not assume all players "want
  identical control schemes or competitive intensity".
- **Test** — Win a match using only pause, orders issued while paused, and speed controls. If
  impossible, O4 ≤5.

**O5 · Baseline accessibility**
- **10** — Keyboard-reachable UI, respects `prefers-reduced-motion`, colour is never the sole
  carrier of team identity (shape and position also differ), HUD scale is adjustable, text meets
  contrast minimums against a near-black field.
- **5** — Contrast is fine; everything else assumes a mouse and full colour vision.
- **Failure mode named** — HW3 had to add a HUD scale slider post-launch after "the HUD consumed
  too much screen space".
- **Test** — Play with a deuteranopia filter over the screen. Can you tell the fleets apart?
  Then unplug the mouse and try to reach the build menu.

---

### 3.8 Audio

Audio is scored separately because it is the cheapest large gain available to a project like this,
and because its absence is the most immediately noticeable "unfinished" signal in a browser build.

**S1 · Order acknowledgement**
- **10** — Every order produces an immediate, distinct sound. Different for move, attack, build,
  invalid. Voice or radio-static bark for the fleet.
- **5** — A single UI click.
- **Failure mode named** — the acknowledgement bark is the genre's canonical latency-hiding
  technique; without it, responsiveness must be carried entirely by animation.
- **Test** — Play with the screen off. Can you tell whether your order registered?

**S2 · Combat audio with scale**
- **10** — A mass driver, an ion beam and a capital-ship death are unmistakably different and
  correctly scaled — the mothership dying is felt, an interceptor dying is a pop. Distance
  attenuates and low-passes.
- **5** — Generic weapon sound, generic explosion.
- **Praise pattern** — BFG:A2's "weighty, satisfying" reputation is substantially an audio
  achievement.
- **Test** — Close your eyes during a battle and describe what is happening. If you cannot
  distinguish a capital engagement from a fighter skirmish, S2 ≤3.

**S3 · Score and space**
- **10** — Ambient, restrained, sparse; swells on engagement, retreats in the quiet. Silence is
  used deliberately.
- **5** — A loop.
- **Praise pattern** — Ruskay's Homeworld score deliberately avoided "climactic orchestral music"
  in favour of an ambient electronic style with tribal and Indian influences, set against the
  choral *Adagio*. The restraint is the point, and it matches DESIGN.md's "emptiness is the
  subject".
- **Constraint note** — `ARCHITECTURE.md` forbids binary assets, so all audio must be synthesised
  at runtime via WebAudio: oscillators, noise buffers, convolution from generated impulses. This is
  entirely achievable and is the same discipline already applied to textures.
- **Test** — Mute the game for five minutes and then unmute. If nothing is lost, the audio is not
  doing work.

**S4 · Mix discipline**
- **10** — 400 simultaneous weapon impacts do not produce clipping mud. Voice sits above combat.
  Per-category volume controls; a master mute that is discoverable.
- **5** — It gets loud.
- **Test** — Trigger a 400-unit engagement with the master at 100%. Check for clipping. Then check
  you can still hear an order acknowledgement.

---

### 3.9 Spectacle & Scale

**P1 · The first ten seconds**
- **10** — The opening frame stops the viewer. A capital fills the screen, the nebula is enormous,
  and the sense of scale lands before any interaction.
- **5** — It looks nice.
- **Test** — Show the first frame to five people for three seconds each. Ask what it is. If anyone
  says "a screensaver" or "a tech demo", the framing is wrong. This is the §4 quality bar in
  `ARCHITECTURE.md` applied to motion rather than stills.

**P2 · Scale contrast is constant**
- **10** — A fighter is never allowed to look like a capital. There is nearly always a size
  reference in frame.
- **5** — Scale reads when both are visible.
- **Test** — Take ten random gameplay screenshots. In how many can you infer the size of the
  largest object? Target ≥8.

**P3 · Destruction is proportionate**
- **10** — A mothership dies over many seconds, in stages, with secondary detonations and drifting
  wreckage. An interceptor is gone in a frame.
- **5** — Same explosion, different scale factor.
- **Test** — Kill one of each class. Time each death. If the range is under 5:1, deaths are not
  scaled to mass.

**P4 · Restraint**
- **10** — The screen is mostly empty most of the time, and the spectacle lands harder for it.
- **5** — Constant effects.
- **Failure mode named** — Nebulous is praised for combat that "keeps the tension ratcheted up
  without numbing you with a screen constantly full of explosions". This is DESIGN.md's
  "keep at least a third of the sky honestly empty", applied to VFX.

---

### 3.10 Session Shape

**T1 · Time to first meaningful decision**
- **10** — Under 60 s: something to build, somewhere to send a scout, a resource seam to claim.
- **5** — Two to three minutes of setup before anything matters.
- **Failure mode named** — Sins II: "there aren't many ways into the game for new players, nor
  much that feels immediately fun to do, with the cool moments landing at least an hour into a
  game".
- **Test** — Time from first frame to the player's first consequential choice.

**T2 · The match has a curve**
- **10** — Tension rises: probing, first contact, a mid-game swing, a climactic assault, a decisive
  end. There is a moment you would tell someone about.
- **5** — Steady escalation to a fleet-versus-fleet blob.
- **Test** — Play three matches. Write one sentence about the most memorable moment in each.
  If all three sentences are the same, T2 ≤4.

**T3 · It ends cleanly and at the right time**
- **10** — Decisive within 30–60 minutes. When the result is settled, the game says so — no
  20-minute mop-up hunting the last collector.
- **5** — Ends by base destruction only; the endgame is a search.
- **Failure mode named** — the mop-up problem is the standard tail on single-victory-condition
  RTS; CoH's Victory Points exist partly to solve it.
- **Test** — Record end-to-end match times over five matches. Then measure the gap between "the
  result became obvious" and "the game declared it". Target under 5 minutes.

**T4 · Reason to start match two**
- **10** — Something changes: a different seed, a different opponent personality, a different
  starting condition, a stat you want to beat.
- **5** — Identical setup, different asteroid positions.
- **Failure mode named** — HW3's War Games was praised as a loop but faulted for "limited options,
  variations, level types". Void Sovereign's seeded universe is a genuine asset here — but only if
  the seed changes something the *player* notices, not only the nebula.
- **Test** — After a match, is there a visible, single-click way to start a different-feeling one?

---

## 4. Skirmish-specific concerns

We have no campaign. Everything the campaign normally does — teach, pace, vary, motivate,
and provide narrative payoff — must be done by the skirmish loop or not at all.

**What makes 30–60 minutes of comp-stomp compelling**

- **A shape imposed by the map, not the script.** Sins II is praised because "celestial mechanics
  bless the game's wars with incredible texture, giving each map a unique rhythm", with phase lanes
  "creating breathing room before everything links up again". Our equivalent is the resource
  geography: home seams, expansion seams, contested midline. That structure already exists in
  `spawn.js`; the question is whether the player *feels* it as three distinct phases.
- **Distance as a pacing tool.** HW3's cardinal skirmish sin was cramped maps where "everything
  becomes a furball right on each other's doorstep" against a series whose maps "were so large that
  you could get lost in them". Travel time is not dead time; it is the space in which decisions
  become irreversible and therefore interesting.
- **Fog and discovery.** "With absolutely zero exploration it loses all its depth." Scouting must
  be a real activity with real risk, and the sensors view must show *what you have seen*, not
  what exists. A skirmish where you can see the enemy's build from minute one has deleted its own
  first act.
- **An opponent with a personality.** Without a story, the AI *is* the antagonist. Named
  personalities with distinct openings are the cheapest available narrative, and HW3 arrived at the
  same conclusion post-launch with its Sentinel and Swarm personas.
- **A named identity for the player.** Stardock's fix for "limited player anchoring" is commander
  personification with voice and visual presence. In a skirmish-only game this is the only
  anchoring available.
- **A post-match number worth beating.** With no campaign progression, the run summary is the
  progression. Fleet value at victory, hulls lost, duration, seed — a shareable line.
- **Variety generated, not authored.** The seeded universe is the right instinct, but seeds must
  vary things that change *play*: seam distribution, separation distance, starting fleet
  composition, an asteroid-dense field versus an open one. A different-coloured nebula is not a
  different match.

**What makes a skirmish hollow**

- One viable build order. If the optimal opening is identical every match, there is one match.
- An economy that cannot be attacked, so there is no reason to leave home before you are ready.
- A victory condition reachable only by grinding down the largest object on the map.
- No mid-match swing: whoever wins the first engagement wins.
- An AI that neither surprises nor concedes.
- No stakes on any individual ship, so no fight is worth watching.

**The minimum viable skirmish shell.** Before the match: seed, difficulty, opponent personality,
map density, starting fleet size. During: pause, speed, sensors, objectives readout. After: summary
and a one-click rematch that is *different*. Currently most of this is URL parameters, which means
in practice it does not exist.

---

## 5. The "browser demo" trap

The specific tells that make a viewer file a web game under "impressive tech demo" rather than
"game", and the counter to each. WebGL builds are widely criticised as compromised versions of real
games — features stripped, "noticeably sloppier", unreliable — so the burden of proof is on us.

| Tell | Why it reads as a demo | Counter |
|---|---|---|
| **Silence** | Nothing signals "unfinished asset pipeline" faster. Real games have sound before they have polish. | Synthesised WebAudio: order barks, weapon layers, capital-ship rumble, ambient bed. No binary assets needed. |
| **First-run stutter** | Shader compilation hitches on first explosion, first beam, first new ship type. Diagnostic: "stuttering is worse on first playthrough and improves over time". | Pre-compile during the boot screen — `WebGLRenderer.compileAsync` / `KHR_parallel_shader_compile`. Warm every material and effect before the first frame. The boot overlay is already the right place. |
| **No settings** | A demo has no options; a game has a menu. | Quality, audio volumes, HUD scale, control rebinding, all persisted to `localStorage`. |
| **No way to start over meaningfully** | Refreshing the page is not a restart. | An explicit new-match flow with choices. |
| **State lost on refresh** | Nothing to come back to. | Persist seed, settings, and best-result stats. A resumable match is better still. |
| **One camera angle in every screenshot** | Suggests only one angle works. | Ship the demo with a cinematic idle/attract camera and prove otherwise. |
| **No failure states handled** | WebGL context loss, tab backgrounding, low memory — a demo crashes, a game recovers. | Handle `webglcontextlost`, pause on `visibilitychange`, degrade quality rather than dying. *`installAdaptiveQuality` already exists — extend it.* |
| **Loading screen that lies** | Fake progress bars are a demo tell. | The current staged boot with real labels is correct. Keep it honest. |
| **Nothing to do while it loads** | Dead time invites the back button. | Text worth reading, or the nebula assembling in view. |
| **Desktop-only assumptions** | Reads as a prototype on a phone. | Touch controls exist in `input.js`; verify they are genuinely playable, or gate mobile with an honest message rather than a broken experience. |
| **"Fullscreen" not offered** | Windowed 3D in a browser chrome frame looks like a widget. | Offer the Fullscreen API prominently, and pointer-lock where appropriate. |

**The overriding one:** the fastest way to be dismissed as a tech demo is for the first
interaction to feel worse than the first *look*. Our visual bar is high. That raises, not lowers,
the required standard for the first click.

---

## 6. Prioritised gap list for Void Sovereign

Assessed against the rubric above by reading `ARCHITECTURE.md`, `DESIGN.md`, `src/sim/*.js`,
`src/ui/*.js`, `src/core/input.js` and `src/ships/catalog.js`. This is what is missing, honestly
ranked. Line references are to the current working tree.

### What is already strong — do not regress it

Worth stating plainly, because the gaps below are long and the foundation is not weak.

- **The sensors view exists** (`src/ui/sensors.js`, 518 lines, bound to Tab, with band-select at
  `sensors.js:140`). This is the series' signature interface feature and it is present. §3.5/M5.
- **The AI is a genuine commander**, not a spawner (`src/sim/ai.js`, 714 lines): it censuses,
  observes, runs an economy, gates tech by time, harasses, masses before committing, and retreats
  wounded capitals (`_retreat`, `ai.js:809`). It carries the comment *"No resource cheating at
  'normal'"* and the difficulty table shows income 1.0 at normal, 0.9 easy, 1.15 hard — modest and
  disclosed. That is the honest side of §3.6/A1.
- **Stances are mechanical** (`combat.js:31–36`): scan range, leash, chase, fire and standoff all
  vary. This is precisely the system HW3 deleted.
- **Rock-paper-scissors data is real** (`catalog.js` `AFFINITY`, e.g. flak 1.6 vs fighter / 0.18 vs
  capital; ion 0.12 vs fighter / 1.5 vs capital). The table is well-shaped.
- **Control groups, formations, speed control, tactical pause and an order gizmo** are all
  implemented in `input.js`.
- **A post-match summary already exists** (`hud.js:890`) with hulls built/lost, kills, resources
  and duration.
- **Adaptive quality** exists (`main.js:401`).

### P0 — Blockers. These define the first impression.

**G1 · There is no audio. At all.**
A search across `src/` and `index.html` for `audio`, `sound`, `AudioContext`, `oscillator`,
`.wav` and `howler` returns **zero matches**. Category 3.8 scores 0/10 in full, and it takes
§3.2/C2 (order acknowledgement), §3.9/P3 (destruction weight) and most of §5 down with it.
This is the largest single gap in the project and probably the highest ratio of perceived
quality to effort.
*Fix:* a `src/audio/` module synthesising everything at runtime — WebAudio oscillators, filtered
noise bursts, generated impulse responses for reverb. Minimum viable set: order acknowledgement,
kinetic impact, beam, explosion (scaled by mass), engine bed, and an ambient pad. All within the
zero-binary-assets rule, exactly as textures already are.

**G2 · Order queueing is advertised and silently discarded.**
`input.js:745` emits `cmd:move` with `queue: !!queue`, and `input.js:753` does the same for
`cmd:attack`. But `world.js:635` and `world.js:653` both execute `e.orderQueue.length = 0` before
pushing, unconditionally. The `queue` flag is never read. Meanwhile `CONTROL_SCHEME`
(`input.js:66`) tells the player *"Shift + right click — Queue the order"*.
This is a §3.2/C4 automatic blocker: the help panel makes a promise the simulation breaks. It is
also a small fix — honour the flag, and draw the queued waypoints.

**G3 · No attack-move.**
No `attackMove`, `guard` or `patrol` order exists anywhere in `src/`. Homeworld 3 shipped without
attack-move and had to restore it as one of five headline changes made in response to player
revolt. Without it, sending a fleet across the map to engage what it meets requires either
micromanagement or reliance on aggressive stance leashing — which is not the same verb and does
not do the same job. §3.2/C3.

**G4 · Ship roles are never explained to the player.**
Every one of the 13 classes in `catalog.js` carries a hand-written `description` — *"A gun with a
ship built behind it. Cuts capitals in half; cannot track fighters."* — and a grep for
`.description` across `src/ui/` and `src/core/input.js` returns **nothing**. `src/ui/build.js`
(300 lines) renders no tooltip. The `AFFINITY` table and `dpsAgainst()` are likewise invisible.
The rock-paper-scissors exists and the player cannot learn it except by losing. §3.1/R4, §3.5/E4.
*Fix:* tooltips on the build menu and the selection roster showing role, cost, the one-line
description, and the counter relationship. The copy is already written.

**G5 · There is no onboarding.**
The only guidance is the `H` help panel, which dumps the whole scheme at once — the exact
"15 hotkeys and they close the game" failure. There is no first-run flow, no contextual hint, no
tutorial, and no identity for the player. §3.7/O1, O2, O3 all score ≤3.
*Fix, cheapest first:* (a) a three-step first-run overlay — select, move, build — that dismisses
permanently; (b) contextual one-line hints fired from existing bus events (first large selection →
formation hint; first `sim:damage` → stance hint; first surplus → build hint), reusing the
`ui:toast` channel that already exists; (c) a named commander identity in the boot copy and the
HUD.

### P1 — Structural. These decide whether the match is worth finishing.

**G6 · Right-click is mode-dependent on selection state.**
`CONTROL_SCHEME` (`input.js:61–74`) documents right-click as *move* and right-drag with nothing
selected as *orbit*, with `Alt + right drag` and middle-drag as escapes. This is verbatim the
most-complained-about control decision in Homeworld 3. The mitigations exist, which is better than
HW3 managed, but the primary path still changes meaning based on invisible state.
*Fix:* make orbit unambiguously middle-drag or a held modifier; if right-drag-orbit is kept as a
convenience, show a cursor state that previews which verb will fire. Then add rebinding (§3.7/O5).

**G7 · Formations have no combat effect.**
`src/sim/formations.js` (224 lines) generates geometric offsets and station-keeping tightness only.
There is no damage, accuracy, range or survivability modifier anywhere. Homeworld 1 gave aggressive
fighters roughly +30% damage and +35% range; removing formation bonuses in HW2 and behaviour orders
in HW3 is named in reviews as a loss of depth. Six formations that alter shape but not outcome are
six identical formations. §3.4/D3.
*Fix:* small, legible modifiers per formation × role, surfaced in the HUD. Wall = better facing
arc; sphere = flak coverage; delta = closing speed; claw = concentration bonus. They need not be
large; they need to be real and stated.

**G8 · No pre-match setup.**
Difficulty comes only from `?difficulty=` (`main.js:226`), seed from `?seed=`, quality from
`?quality=`. A visitor cannot choose an easier opponent, a different seed, or a shorter match
without editing the address bar. §3.6/A4 scores ≤3, and §3.10/T4 depends on it entirely.
*Fix:* a start panel over the boot screen — difficulty, opponent personality, seed (with a
"randomise" button), fleet size. It also gives the boot screen something to do while shaders
compile, which addresses two §5 tells at once.

**G9 · One victory condition, no anti-snowball brake.**
`world.js:771` `_checkVictory()` decides purely on base survival. Population (`popProvided`) is the
only soft brake in the economy; there is no upkeep, no defender's advantage, no alternative
victory, and no retreat mechanic that preserves force. Once one side holds a decisive fleet
advantage, the remainder is a formality followed by a mop-up. §3.5/E2, §3.10/T3.
*Fix, cheapest first:* (a) a surrender/concede state and an auto-called result when fleet value
ratio and base health make the outcome certain — this alone fixes the mop-up tail; (b) upkeep or
mildly diminishing income above a fleet-value threshold; (c) optionally a second victory condition
tied to holding contested resource clusters, which would also give the midline band in
`spawn.js` a purpose beyond ore.

**G10 · No attrition depth: no veterancy, salvage, capture or subsystem targeting.**
Grep confirms none of these exist. These are exactly the four systems named as removed from
Homeworld 3 relative to its predecessors, and their loss is central to the "depth systems deleted"
criticism. Repair does exist (`supportFrigate`, `combat.js:662–692`, plus yard repair at
`combat.js:772`), which is the most important of them — but a fight lost is currently a fleet lost.
§3.4/D4.
*Fix, in value order:* veterancy first (cheap, visible, gives individual ships history and makes
withdrawal worthwhile); then salvage/capture, which is the Homeworld signature and would
meaningfully change the economy; subsystem targeting last, as it costs the most UI.

### P2 — Polish and verification. Cheap wins and things to confirm by hand.

**G11 · Order acknowledgement is visual-only, and unmeasured.**
The gizmo and selection markers exist, but nothing confirms an order landed before the ships turn.
Measure it: screen-record at 60 fps and count frames from mouse-up to first changed pixel (§3.2/C2
test). Pair with G1's audio bark.

**G12 · Tactical pause is implemented but not sold.**
`SPEED_STEPS` includes `0` and `Space` toggles it (`input.js:41`, `input.js:660`). Input handling
lives outside the loop's `timeScale`, so orders issued while paused should register — **this needs
confirming by hand**, and if it works it should be advertised, since tactical pause was one of the
few HW3 mechanics reviewers consistently praised. §3.7/O4.

**G13 · Shader pre-compilation during boot.**
The staged boot in `main.js` is the right structure and honest about progress, but there is no
evidence of `compileAsync` or a material warm pass. First explosion, first ion beam and first
capital death are prime candidates for a first-time hitch. §5.

**G14 · No persisted settings, no in-game options.**
No `localStorage` usage. Quality, future audio volumes, HUD scale and rebinding all need somewhere
to live. §3.7/O5, §5.

**G15 · Colour is doing too much work for team identity.**
Player cyan versus enemy amber is excellent design (`DESIGN.md`), but both teams field the *same
roster* by deliberate choice ("the way Kushan and Taiidan did"), so under a colour-vision
deficiency the two fleets may be genuinely indistinguishable. Verify with a deuteranopia filter and
add a redundant cue — outline weight, marker shape, or a hull-palette divergence. §3.7/O5.

**G16 · Verify multi-select and command coherence at the stated 1,000-unit budget.**
The architecture targets 1,000+ live units. The rubric tests in §3.3/M1 and M2 have not been run.
This is where "wrangling fleet groups is unwieldy" would show up, and it is the difference between
a unit cap that is a rendering achievement and one that is a playable one.

**G17 · Confirm the seed changes play, not just appearance.**
`setupSkirmish` (`spawn.js:181`) varies cluster angles, distances and amounts, but `separation`,
`clustersPerSide` and the opening fleet are fixed defaults. Two seeds probably produce two similar
matches in a different-coloured nebula. §3.10/T4.

---

## 7. Sources

Reviews, aggregators and developer statements used above. Community threads are cited as evidence
of *pattern and volume of complaint*, not as authority.

**Homeworld 3**
- [Metacritic — Homeworld 3](https://www.metacritic.com/game/homeworld-3/) (Metascore 75 / user 3.0)
- [Steambase — Homeworld 3 Steam charts](https://steambase.io/games/homeworld-3/steam-charts)
- [TheSixthAxis — Homeworld 3 review](https://www.thesixthaxis.com/2024/05/10/homeworld-3-review/)
- [The Avocado — Homeworld 3 Review: 3D RTS Falls Flat](https://the-avocado.org/2024/06/10/homeworld-3-review-3d-rts-falls-flat/)
- [GamesRadar — Homeworld 3 review](https://www.gamesradar.com/games/real-time-strategy/homeworld-3-review/)
- [Game Rant — Homeworld 3 review](https://gamerant.com/homeworld-3-review/)
- [Homeworld Universe — Dev Update: Update 1.3 improvements](https://www.homeworlduniverse.com/dev-update-unpacking-the-biggest-improvements-coming-to-update-1-3/) *(developer admissions)*
- [Homeworld Universe — 5 Big Changes We're Making Because Of Your Feedback](https://www.homeworlduniverse.com/war-games-feedback/) *(developer admissions)*
- Steam Community discussion threads on camera, control scheme, skirmish map count and story (multiple; used for pattern volume)

**Homeworld lineage**
- [PC Gamer — Homeworld: Deserts of Kharak review](https://www.pcgamer.com/homeworld-deserts-of-kharak-review/)
- [Kotaku — Deserts of Kharak review](https://kotaku.com/homeworld-deserts-of-kharak-the-kotaku-review-1753684243)
- [The Digital Antiquarian — Homeworld](https://www.filfre.net/2026/01/homeworld/)
- [Encyclopedia Hiigara — Tactics](https://homeworld.fandom.com/wiki/Tactics) and [Formations](https://homeworld.fandom.com/wiki/Formations) *(HW1 stance and formation bonuses)*
- [Forbes — Paul Ruskay on composing the Homeworld soundscape](https://www.forbes.com/sites/olliebarder/2022/01/18/paul-ruskay-on-how-he-composed-the-unique-soundscape-for-the-homeworld-games/)

**Adjacent space RTS**
- [PC Gamer — Sins of a Solar Empire 2 review](https://www.pcgamer.com/games/strategy/sins-of-a-solar-empire-2-review/)
- [PCGamesN — Sins of a Solar Empire 2 review](https://www.pcgamesn.com/sins-of-a-solar-empire-2/review)
- [Metacritic — Nebulous: Fleet Command](https://www.metacritic.com/game/nebulous-fleet-command/)
- [Screen Rant — Battlefleet Gothic: Armada 2 review](https://screenrant.com/battlefleet-gothic-armada-2-review/)
- [OpenCritic — Battlefleet Gothic: Armada 2](https://opencritic.com/game/7216/battlefleet-gothic-armada-2/reviews)

**RTS craft and design literature**
- [Wayward Strategy — Let's Talk RTS User Interface (Dave Pottinger interview)](https://waywardstrategy.com/2015/05/04/lets-talk-rts-user-interface-part-1-interview-with-dave-pottinger/)
- [Wayward Strategy — Unit Design, Clarity of Roles and Redundancy](https://waywardstrategy.com/2018/05/17/unit-design-clarity-of-roles-and-redundancy/)
- [Wayward Strategy — Anti-Snowball Design](https://waywardstrategy.com/2020/07/06/anti-snowball-design/)
- [Stardock — Ashes Dev Journal: Accessibility Woes of RTS](https://www.stardock.com/games/article/488153/ashes-dev-journal-accessibility-woes-of-rts)
- [PC Gamer — Tempest Rising review](https://www.pcgamer.com/games/strategy/tempest-rising-review/)
- [TV Tropes — Not Playing Fair With Resources](https://tvtropes.org/pmwiki/pmwiki.php/Main/NotPlayingFairWithResources) *(catalogue of AI resource cheating across the genre)*

**Latency, WebGL and browser delivery**
- [Springer — Are 100 ms Fast Enough? Characterizing Latency Perception Thresholds in Mouse-Based Interaction](https://link.springer.com/chapter/10.1007/978-3-319-58475-1_4)
- [Wikipedia — Input lag](https://en.wikipedia.org/wiki/Input_lag)
- [three.js — WebGLRenderer docs](https://threejs.org/docs/pages/WebGLRenderer.html) *(`compileAsync`, `KHR_parallel_shader_compile`)*

**Unverified / could not retrieve**
- Claypool, *The effect of latency on user performance in Real-Time Strategy games* — the RTS-specific
  latency study. ResearchGate returned 403; the thresholds in §3.2/C2 therefore come from general
  mouse-interaction HCI literature and should be treated as indicative rather than RTS-calibrated.
- Rock Paper Shotgun and PC Gamer Homeworld 3 reviews — both blocked at fetch; their positions are
  represented here only where corroborated by retrievable sources.
- Live Homeworld 3 concurrent-player figures beyond the peak and the 30-day average cited above.
