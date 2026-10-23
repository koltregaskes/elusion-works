# P46: loading screen and faster match build, for the HOMEWORLD lane

**What the patch does.** It turns the bare "bar and one line" loading card into
a real build screen, says so on the title screen while the game's modules are
still loading, and cuts the match build from **44.5 s to 16.2 s at low** and
**93.4 s to 28.6 s at default quality** (headless, medians of three, Take
command to a live match). The speed-up is one change in `main.js`: stop
drawing the 3D scene behind the opaque loading card while a match builds.

**How to apply.** From the repo root, on top of `262342a`:

```
git apply demos/void-sovereign/.local/p46-loading/loading-screen.patch
```

`git -C W:\Websites\.vs-pr29 apply --check --cached` passes against the index,
which equals `262342a` (output in `apply-check.txt`). It does **not** apply to
the current uncommitted working tree in `.vs-pr29`: R12 fix 3 adds
`warmDeaths` inside the "Casting the wreck moulds" step, which is one of the
lines this patch changes. Apply it after fix 3 is committed with
`git apply -3`, or by hand: keep fix 3's lines and change only that step's
first argument to `0.46` and its closing `});` to `}, 'image');`. Fix 3's
warm-up is CPU-side and its buffers upload on the first frame, which this
patch still draws behind the card, so the two are compatible.

**What it touches.** Lane A files only: `index.html`, `src/main.js`,
`src/ui/shell.js`, `styles/shell.css` (+513, -37). No engine, post, FX or sim
file is changed, nothing is downloaded, no asset is added.

## The three parts

1. **Page load (index.html, shell.css).** The title screen already paints from
   static markup (first contentful paint about 0.7 s headless), but its buttons
   do nothing until three.js and the shell have loaded (about 0.8 s here, more
   on a slow connection). A one-line "Loading the game systems" strip with a
   hairline sweep now sits under the menu, and the menu buttons are dimmed and
   unclickable, until the shell sets `is-live` on `#vs-shell`; then the strip
   fades out and the menu works. No script involved; it is pure CSS on a class
   the shell already set.

2. **The build card (shell.js, shell.css).** Same drawing language as every
   other screen (hairlines, tracked mono, cyan for us, no boxes):
   - the six real build stages, grouped from the 14 steps in `main.js`
     (Hull plating and paint, Nebula and sky, Hulls and keels, Fleets and
     orders, Comms and displays, Image and shaders), each ticked off with the
     time it actually took; a shallow restart marks the first three "kept";
   - the bar, now weighted by measured stage time instead of step count, with
     a percentage, and a glint that crosses it on the compositor so the card
     still moves while a stage holds the main thread;
   - the existing status line (the flavour labels are unchanged, plus
     "Preparing shaders" and "Drawing the first frame and compiling its
     shaders");
   - a "Field note" that changes every 7 s, drawn from STORY.md (only lines
     that the codex already treats as true of the sim).
   `setProgress(value, label, stage)` gains an optional third argument, so any
   older caller still works.

3. **Faster build, separate hunk (main.js).** Clearly labelled "boot speed,
   P46" in the code:
   - `engine.render` is wrapped (instance-level, `core/engine.js` untouched)
     so nothing is drawn while `startMatch` runs. The old build drew every
     frame behind the opaque card, so each stage paid synchronous shader
     compiles in the next frame, and every program compiled before the post
     stack existed was a canvas variant that was thrown away and compiled
     again once rendering moved into the post target. Programs linked per
     build: 86 to 63 at low, 93 to 67 at default.
   - `compileForFirstFrame()` queues both scenes' programs into a 1 x 1 target
     (same trick as `compileFleetBatches`). On this software driver it saves
     nothing by itself; on a driver with parallel compile it lets the
     programs compile together.
   - The frame is released after the build and one frame is drawn behind the
     card before the handoff, so `playing` reveals the new battlefield.

## Risks

- **Frame hold during a restart.** While a match builds, render hooks do not
  run (camera, input, audio `update`, environment, FX, HUD). The card is
  opaque, so nothing visible changes, but the music scheduler pauses for the
  length of the build on a restart from a live match. Tested: a shallow
  restart from a live match rebuilds in 1.5 s, marks the first three stages
  "kept" and returns to `playing` with 32 entities and 0 errors.
- **First frame is still the long step on this box.** Shadow-depth and post
  pass programs are not reachable by `renderer.compile()`, so on a software
  driver they still compile one at a time in the first frame (14 to 21 s at
  default headless, behind the card, with the status line saying so).
- **Progress weights are headless numbers.** On the target laptop the image
  stage will be much shorter, so the bar will run behind and then finish
  early. It never overstates progress.
- **Nebula stage noise.** It measured 1.7 to 4.5 s in the new build against
  2.5 to 3.2 s before, run to run on a shared machine; medians at default were
  equal. Not explained, noted.
- **`bootTimings` gains one entry** ("Preparing shaders…"). Probes that read
  it by label (`r9-fix1-hitch.mjs`, `laneE-probe.mjs`) look up other labels
  and are unaffected.
- Not checked on a real GPU or in a visible window (Mini PC rule). Not
  checked: medium and ultra quality, `?adaptive=1`, context loss during a
  build.

## Verification (headless, `work/`)

- Every run clicked New game, Continue and Take command, reached `playing`,
  drew a frame (`__VS.ready`) and ticked the sim with 32 entities: 6 timing
  runs, 2 final runs (1600 x 900 and 390 x 844), plus probes.
- Console errors 0, page errors 0, failed requests 0, `__VS.loadErrors` 0 in
  every run of both builds.
- Page load: the strip and dimmed menu are in the static markup, so they are
  in the first contentful paint (724 ms); with `main.js` held back 3 s the
  title showed the strip, New game had `pointer-events: none`, a click on it
  did nothing, and when the shell went live the strip hid and New game worked.
- Shallow restart from a live match: see Risks.

## Evidence

Everything is in `W:\Websites\sites\elusion-works\demos\void-sovereign\.local\p46-loading\`.

- `timings.md`: before and after medians, all 12 runs, stage table.
- `apply-check.txt`: the recorded `git apply --check --cached` output.
- `screens/`: `work-first-second.png` (page at 0.7 s, modules held back by the
  harness so the pre-live state is visible), `work-menu-live.png` (handoff to
  the live menu), `work-low-loading-1-nebula.png`, `-2-after-keels.png`,
  `-3-image.png` (the card advancing; a screenshot cannot land inside the
  4 s hull stage because capture waits for the main thread, so shot 2 shows
  the stage after it with the keels time ticked off), `work-low-match.png`
  (match running), `work-phone-*.png` (390 x 844, same flow), and `base-low-*`
  shots of the old card. `base-low-loading-2.png` was requested at 16.9 s and
  only arrived at 55.7 s: the old card could not even be captured through the
  shader stall.
- `harness/`: `profile.mjs` (boot profiler, click-through, restart check),
  `firstpaint.mjs`, `summarise.mjs`, `make-patch.sh`, `serve.mjs`,
  `timing-batch.sh`. Rerun any of them with `node`; each takes the shared
  chrome lock and closes its own server.
- `base/` and `work/`: the pristine `262342a` copy and the patched copy.
