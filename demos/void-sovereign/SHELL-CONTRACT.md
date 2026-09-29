# Shell contract — menus, options, tutorial

This is a binding contract, in the same sense as ARCHITECTURE.md. Three lanes
build against it in parallel. **Do not edit a file you do not own.** If you need
something from another lane, use the API below or the event bus; if the API is
missing something, say so in your report rather than reaching into their files.

## Why this exists

Kol played the deployed build and reported, verbatim:

> * It goes straight into the game and doesn't explain anything.
> * There's no menu at all and it clearly needs a menu in a UI.
> * I need a mini tutorial. Is there one there? Is there a story? What are the
>   controls and can I change them?
> * Think of it as a full game. I can't start and pause, and I can't end the game.
> * There's lots more functionality. I think the boring stuff, the admin, you
>   need to work on.

Every one of those is a shell problem, not an engine problem. The sim, the HUD,
the renderer and the audio are all in good shape. What is missing is the game
*around* the game.

Note the trap in "I can't start and pause": tactical pause **already exists** on
Space, time scaling already exists, and `sim:gameOver` already fires. The defect
is that none of it is discoverable and none of it is reachable from a menu. Do
not rebuild these systems. Surface them.

## The state machine (Lane A owns it)

```
        ┌──────────────────────────────────────────────┐
        v                                              │
   [ title ] ──New Game──> [ setup ] ──> [ loading ] ──┴──> [ playing ]
        ^                                                    │      ^
        │                                                    │      │
        │                                              Esc ───┤      │ Resume
        │                                                    v      │
        ├────────── Quit to menu ──────────────────────── [ paused ]─┘
        │                                                    │
        │                                              Restart│
        │                                                    v
        └────────── Main menu ───────────────────────── [ gameOver ]
```

States are exactly: `title`, `setup`, `loading`, `playing`, `paused`, `gameOver`.

Rules that are not negotiable:

1. **Restart and quit-to-menu must not reload the page.** A reload throws away
   the warmed shader cache and costs 5–13 s of boot. Use the teardown that
   already exists (`__VS.dispose`, `shipsMod.disposeFleetBatches()`,
   `disposeShipCache()`) and rebuild the world. If you find teardown leaks,
   fix them — a leak that survives three restarts is a bug, and the tenth
   restart must be as fast and as clean as the first.
2. **The sim must actually stop in `paused` and `gameOver`.** Not time-scale 0
   as a visual trick — the fixed-step accumulator must not advance. Rendering
   continues so the scene stays live behind the menu.
3. **Esc is the pause key and it is now Lane A's.** `ui/hud.js` currently claims
   Escape to dismiss its controls card, and `core/input.js` has its own handler.
   Lane A arbitrates: Esc closes the topmost overlay if one is open, otherwise it
   opens the pause menu. Coordinate through the API, do not fight over keydown.
4. **Every state is reachable and leaveable with the keyboard alone**, and every
   overlay traps focus while open. We have already shipped one keyboard trap
   (Tab/Space were claimed at window level and made the HUD unreachable); do not
   ship a second.

## The 60-second test

A stranger should understand what they are doing within 60 seconds, without
anyone sitting next to them. Kol's follow-up was blunt: *"It went straight into
a game and I didn't quite understand what I'm doing."*

Two consequences, both ranked above any further visual polish:

- **A briefing step before gameplay starts.** After setup and before the match,
  a short screen that states the objective in plain words: who you are, what you
  are trying to do, and how you know you have won. Not a wall of lore — the
  three victory conditions and your immediate first move. Lane A owns this; it
  is a state between `setup` and `loading`.
- **A standing objective readout in the HUD.** At any moment the player must be
  able to see what they control, what the objective is, and how close either
  side is to winning. The sovereignty clock and seam control already exist in
  `src/sim/economy.js` and are currently invisible. Surface them. Lane A owns
  the HUD change.

## Public API — `window.__VS.shell` (Lane A provides, B and C consume)

```js
shell.state                      // current state string, read-only
shell.go(state, opts)            // request a transition; returns false if illegal
shell.pause() / shell.resume()
shell.registerPanel({
  id,                            // 'options' | 'tutorial' | 'codex' | ...
  title,                         // menu label
  where,                         // ['title'] and/or ['pause'] — where it appears
  order,                         // sort hint, lower is earlier
  mount(container),              // build DOM into container; called once, lazily
  onOpen(), onClose(),           // optional
})
shell.openPanel(id) / shell.closePanel()
shell.on(event, fn)              // 'stateChange' | 'panelOpen' | 'panelClose'
```

Panels are lazily mounted on first open so the title screen stays instant.

## Bus events (additions to the frozen table in ARCHITECTURE.md §2)

| event | payload | emitted by |
|---|---|---|
| `shell:state` | `{ from, to }` | Lane A |
| `shell:pause` | `{ paused: bool, source }` | Lane A |
| `shell:restart` | `{ seed, difficulty, quality }` | Lane A |
| `tutorial:step` | `{ index, id, done }` | Lane C |
| `tutorial:complete` | `{ skipped: bool }` | Lane C |
| `options:changed` | `{ key, value }` | Lane B |

Existing events keep their current meaning. `sim:gameOver` already fires with
`{ winner, reason }` where reason is `base` | `sovereignty` | `attrition` — Lane A
drives the end screen off it and must render all three reasons in plain English.

## File ownership — strict

**Lane A — shell and flow**
- `src/ui/shell.js` (new), `styles/shell.css`, `index.html`, `src/main.js`

**Lane B — options and rebinding**
- `src/ui/options.js` (new), `styles/options.css` (new), `src/core/input.js`

**Lane C — tutorial, story, codex**
- `src/ui/tutorial.js` (new), `src/ui/codex.js` (new), `styles/tutorial.css` (new),
  `STORY.md` (new)

`src/ui/hud.js` is shared and contended. Only Lane A may edit it, and only to
hand Escape over to the shell. B and C must not touch it.

## Quality bar

This is the same bar as the rest of the project. The menus are not a wireframe —
they are part of the art direction. Read ARCHITECTURE.md §3 before you style
anything. The typography, the restraint and the colour discipline of the boot
card are the reference; match it, do not invent a second visual language.

Specifically: no default browser focus rings, no unstyled `<select>`, no
system-font fallbacks, no layout that breaks at 1280×720 or at 2560×1440.

## Gates before you report done

Run these yourself. Do not report success without output.

```
node .local/syntax-check.mjs
node .local/shot.mjs .local/shots/<lane>.png --wait 12000 --w 1600 --h 900
node .local/hidden-check.mjs
```

Required: 39+ modules parse clean · zero console errors · zero page errors ·
the game still boots and plays · draw calls still ~74 in the opening frame.

Add a harness under `.local/` for your own lane and leave it committed-ignored
there, the way the existing probes are. A claim with no measurement behind it is
not a claim — this project has already produced three phantom defects from
eyeballing rather than measuring.
