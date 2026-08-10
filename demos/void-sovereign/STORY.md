# VOID SOVEREIGN — the premise

> **Rule for this file.** Everything below has to be true of the simulation that
> actually runs. No mechanic is described here that `src/sim/` does not
> implement, and no number is quoted here that is not read from
> `src/ships/catalog.js`, `src/sim/economy.js` or `src/sim/world.js` at runtime
> by `src/ui/codex.js`. If the sim changes, this file is wrong and must change
> with it. Lore that contradicts the code is worse than no lore.
>
> It is a demo, not a novel. The whole of it should be readable in ninety
> seconds, and the in-game framing is a third of this length again.

---

## The short version

Two fleets. One field. Neither of them can go home.

You command **the Pale Meridian**. Across the drift, at the far end of a
sixty-kilometre volume of nothing, sits **the Ochre Reach**. You were the same
fleet once. You are not any more.

You win by taking their Mothership, by holding the middle of the field until
their claim runs out, or by leaving them with nothing left to rebuild with.

---

## Who you are

The Pale Meridian is one Mothership and whatever it can still build. There is no
world behind it, no reinforcement fleet, no second front. Every hull you lose is
a hull you paid for out of ore you cut yourself.

You are not a pilot. You are the flag — the voice on the fleet channel that
decides where the line goes. That is why you are looking at the void from
outside it and from above: this is a command plot, not a cockpit.

Cold light is yours. Steel, bone-grey hulls, cyan trim, white running lights.

## Who they are

The Ochre Reach flies the same thirteen classes off the same drawings. That is
deliberate and it is the point: there is no secret hull, no tech the other side
does not have, nothing to discover except what they choose to build and where
they choose to stand. Two commanders, one roster, one field. Everything that
separates you is judgement.

Warm light is theirs. Amber trim, rust, crimson.

## What a Sovereign is

Not a ship. A **Sovereign** is whichever fleet the field still recognises when
the other one's claim has run out.

Sovereignty is a number and it starts at a hundred for both of you. For the
first stretch of the match it does not move at all — the opening is allowed to
be an opening. After that, whoever holds more of the contested band drains the
other's, at a rate set by the size of the margin rather than by how badly the
loser is doing. A side that has given ground away claws its own number back,
slowly, by retaking it.

At zero the claim is void. The other fleet is the Sovereign, whatever the kill
ratio said.

## What the seams are

The drift is full of ore, and ore only comes out of a **seam** — a cut face in
an asteroid cluster that a Resource Collector can work.

Seams come in two kinds and the difference is the whole war:

- **Home seams** sit near your Mothership. They are yours by geography. Nobody
  has to fight for them and they are worth exactly their ore.
- **The contested band** straddles the midline. Every seam in it is placed the
  same distance from both starts, mirrored through the origin, so neither side
  is handed an advantage by the seed. It is the richest ground on the field and
  the least defensible ground on the field.

Standing on a contested seam does two things that home seams never do. It pays
— every seam you hold lifts your income. And it runs the clock: hold more of the
band than they do and their sovereignty falls.

**Presence is warships.** Armed, mobile hulls, counted by what they cost, not by
how many of them there are — twenty Probes do not hold ground against a
Destroyer. Collectors do not take ground. Motherships and Carriers do not go and
sit on a seam. Taking the middle costs you warships that are then not somewhere
else, and that trade is the decision the whole match is built around.

Take a neutral seam with unopposed presence and it becomes yours. Walk away from
it and it drifts back to neutral, because ground you left is not ground you hold.
Push them off it and it swings — the band is a tug-of-war, not a switch, and it
only deadlocks when the two fleets standing on it are genuinely matched.

## Why this fight instead of any other

Because the alternative is a thirty-minute stalemate at a twelve-to-one kill
ratio, which is what a field with only one way to win produces. Winning a fight
and going home used to cost the loser nothing. Now, if you win the fight in the
middle and *stay where you won it*, you convert it into a clock they have to
answer.

And if you are behind on fleet value, you are not finished. You can still answer
a clock by taking ground rather than by winning a set-piece you would lose.

## The three endings

**The Mothership is gone.** The fastest ending, when you can take it. It is the
largest object either side owns and it is the only one that cannot be replaced.

**The contested field decided it.** Sovereignty at zero. The slower ending, and
the one that punishes a commander who is winning everywhere except the middle.

**Nothing left to rebuild with.** No yards, no collectors, no fleet worth the
name. The field calls it rather than making anyone spend twenty minutes hunting
the last hauler across sixty kilometres of empty space.

## Things that are true and worth knowing

- **A fleet is a thing you keep, not a thing you spend.** A hull that survives
  its fights gets measurably better at them — Blooded, then Veteran, then Elite.
  The fleet you are flying at minute twenty-five is not the fleet you were
  flying at minute five, and withdrawing a mauled wing is worth something.
- **A big fleet earns less per hull than a lean one.** Above a free allowance,
  income falls off smoothly with population. Nothing is ever taken away from
  you; the fiftieth Interceptor is simply worth less than the fifth.
- **The economy can be attacked.** Collectors are slow, unarmed and out in the
  open, and a side that loses its haulers stops building about ninety seconds
  later. Yours are exactly as exposed as theirs.
- **A Collector under fire runs.** It downs tools, makes for the nearest yard
  and unloads what it has. It will not sit there and die full.
- **Time is yours.** The battle pauses on Space and every order you give while
  it is frozen is obeyed the moment it resumes. Nothing in this game needs to be
  clicked inside a two-hundred-millisecond window.

---

## In-game framing — the copy that actually ships

The tutorial and the codex carry the premise. Three places, and they are short
on purpose.

**Opening line** (tutorial card, first step)

> The Pale Meridian holds one Mothership and whatever it can build. Across
> sixty kilometres of drift, the Ochre Reach holds the same. One field, one
> roster, one of you left standing on it.

**The seam step** (tutorial, step nine)

> The contested seams straddle the midline — richest ground on the field,
> and the least defensible. Standing on one pays you and runs a clock against
> them. Presence is warships, weighed by what they cost. Collectors do not take
> ground.

**The closing card** (tutorial complete, and the codex "Briefing" tab)

> You have the verbs. Three ways this ends: their Mothership dies, their
> sovereignty runs out, or they are left with no yards, no miners and nothing
> to rebuild with. Everything else is where you choose to stand.

## Names

| | |
|---|---|
| Player fleet | **the Pale Meridian** — cold, cyan, bone-grey |
| Enemy fleet | **the Ochre Reach** — warm, amber, rust |
| The prize | **Sovereignty** — the field's recognition of a claim |
| The ground | **seams**, home and contested; the contested ones are **the band** |
| The winner | **the Sovereign** |

Ship classes keep the names in `catalog.js` — Probe, Interceptor, Lance Bomber,
Assault Corvette, Missile Corvette, Assault Frigate, Ion Beam Frigate, Support
Frigate, Destroyer, Heavy Cruiser, Resource Collector, Carrier, Mothership.
Both fleets fly all thirteen. Do not invent a class that the roster does not
contain, and do not give either side a ship the other cannot build.
