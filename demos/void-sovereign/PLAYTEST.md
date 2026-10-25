# Void Sovereign: laptop play test (KOL-6021)

Kol: this is the one test nobody else can do. Every score so far comes from
headless screenshots on the mini PC, with no real GPU, no real hands and no
sense of feel. Thirty to forty minutes on the gaming laptop will tell us more
than another critic round.

## 1. Set up (5 minutes)

Use the branch with all the recent work, `feat/void-sovereign-shell`, not
`feat/void-sovereign` (that one is many rounds behind).

```bash
git clone https://github.com/koltregaskes/elusion-works.git
cd elusion-works
git checkout feat/void-sovereign-shell
node demos/void-sovereign/tools/dev-server.mjs
```

If you already have the repo, run `git fetch` and then `git checkout
feat/void-sovereign-shell` and `git pull` instead of cloning.

Then open `http://127.0.0.1:8899/demos/void-sovereign/` in Chrome or Edge.
You need Node 20 or later and nothing else. Plug the laptop in and close other
heavy apps.

Useful URL options:

- `?seed=13634`: the seed most of our testing used.
- `?seed=99`, `?seed=2718`, `?seed=37`: other skies and palettes.
- `?quality=ultra`: the top graphics tier.
- `?difficulty=hard`: a harder AI.

To see the frame rate, open DevTools (F12), press Ctrl+Shift+P, type
"frame rendering stats" and turn it on.

## 2. What to play (about 30 to 40 minutes)

1. **Boot.** Time it from opening the page until you can click a ship. We
   measure about 29 s headless; a real GPU should be faster.
2. **Tutorial.** Play the first few steps, then press Skip and Dismiss. Does
   it teach the controls without getting in the way?
3. **One full match, default seed and difficulty.**
   - Build collectors first, then frigates, then a destroyer or two.
   - Gather the fleet with its capital ships, then attack. The enemy now
     brings its capitals into big fights.
   - Watch the top bar during a big fight. Once one side's sovereignty is
     30% or below, the clock should pause ("Sovereignty paused — battle in
     progress").
   - Let at least one carrier or cruiser die close to the camera (press F to
     focus it).
4. **Two or three other seeds** (`?seed=99`, `?seed=37`). Look at the sky, the
   planet and the rock fields.
5. **Performance.** Switch to `?quality=ultra` at your native resolution and
   watch the frame rate during the biggest fight you can get. The target is
   60 fps at 1440p.

Controls: press H in the game for the full list. The basics:

- left click or drag to select;
- right click to move, or right click an enemy to attack;
- F to focus the camera on the selection;
- Space to pause;
- + and − to change game speed;
- arrow keys to pan.

## 3. What to look for

Please jot down short answers. One line each is plenty.

- **Feel.** Do the controls do what you expect? Is anything sluggish or
  confusing?
- **Camera.** When you press F, does it frame the ship well, or fight rocks?
- **The big battle.** Can you tell what is happening? Which ships are yours,
  what is shooting what, and what is about to die?
- **Capital deaths.** Does a carrier or cruiser death feel big enough? Any
  stutter at that moment?
- **Damage.** Can you tell a ship at half health from one nearly dead?
- **Frame rate** at ultra in the big fight, and any hitches.
- **The look.** Does it feel like a commercial game? What breaks the
  illusion first?
- **Homeworld.** Does it scratch that itch at all?

Screenshots (Win+Shift+S) of anything odd are very welcome.

## 4. Known issues (you do not need to report these)

- **Boot** takes about 29 s. A real loading screen or faster start is still
  to do.
- **HUD numbers** can contradict each other. The population panel and the top
  bar can disagree, and the end screen's "hulls lost" can exceed "commissioned".
- **Near rocks** can look faceted or smeared up close.
- **Damage at 50%** is subtle, especially from far away. 20% reads clearly.
- **Hostile fighters** are thin and hard to read at a distance.
- **Hits on capital ships** can look like soft white balls.
- **Peak capital explosions** are briefly overexposed: a cream glow for about
  a tenth of a second.
- **Far ships** can look like flat grey slabs at the longest range.
- **First capital death.** One test caught an 88 ms hitch on a carrier kill.
  Other kills stayed under 50 ms. Please note any stutter you feel when a big
  ship dies.
- **Big fights.** The sovereignty pause has a 210 s budget per match. Once
  it runs out, a match can still end some minutes after its biggest fight.
- **The scripted test player** loses to the AI on every seed we tried, so the
  default difficulty may be too hard for a new player. Your experience matters
  more than ours here.
- **Memory.** On machines very low on memory the browser can lose the
  graphics context. The game now tries to recover. Tell us if you ever see the
  "bigger engine room" panel.

## 5. How to send feedback

Reply on Linear **KOL-6021** with your answers and screenshots, or drop a note
in `W:\agent-docs\handoffs\codex-2026-10\` named
`HOMEWORLD-CLONE-PLAYTEST-<date>.md`. Your frame-rate numbers and your "what
breaks the illusion first" answer are the two most useful things.

Latest critic score and history: `CRITIQUE-ROUND-*.md` in this folder. Round
11 (13 October 2026) scored 5/10 overall, with an axis mean of 5.8. The
critic blind-ranked the three damage states correctly. The weakest point
remains combat legibility in a big played fight.
