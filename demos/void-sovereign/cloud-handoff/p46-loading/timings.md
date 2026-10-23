# P46 boot timings: before (base) and after (work)

**Answer first.** From pressing Take command to a live, drawn match, measured
headless on the Mini PC (software WebGL, SwiftShader), median of three runs each:

| Quality | Before (262342a) | After (patch) | Saved |
|---|---|---|---|
| `?quality=low` | **44.5 s** | **16.2 s** | 28.3 s (64%) |
| default (auto picked `high` here) | **93.4 s** | **28.6 s** | 64.8 s (69%) |

Page open to a live match (menus clicked through by script as soon as they
work): low 46.7 s to 20.3 s, default 95.6 s to 30.8 s. The title screen's
menu becomes live at about 0.8 s in both builds (median), so nearly all of the
"29 s boot" the play test describes is the match build after Take command,
not page load.

These are software-renderer numbers. The dev box ran much slower today than
the 29 s quoted in PLAYTEST.md (another session was sharing the machine), so
read the ratios, not the absolute seconds. A real GPU compiles shaders far
faster, so the absolute saving there will be smaller.

## How it was measured

- Harness: `harness/profile.mjs` (this folder). Fresh `chrome-headless-shell`
  per run through `W:\media\opus-5-5-demos\_tools\chrome-lock.mjs`, a static
  server inside the harness's own Node process on 127.0.0.1 (random port,
  `text/javascript` for .js, closed after each run), 1600 x 900 viewport,
  `?seed=13634`.
- Nothing in `base/` was edited. An init script records: when `window.__VS`
  was assigned, when the engine and shell existed, every loading-card status
  label and shell state change (MutationObserver), long tasks, time spent in
  WebGL compile/link/status calls, program link times, and `__VS.bootTimings`.
- Each run clicks New game, Continue and Take command as soon as each is
  visible, then waits for `__VS.ready` (a live match drawn at least once) and
  checks the sim ticks for 2.5 s.
- Runs were interleaved base, work, base, work at each quality so machine
  load drift hit both sides. Raw data: `data/t-<side>-<quality>-<n>.json`,
  summary: `data/summary.json` (`node harness/summarise.mjs`).

## All runs (ms, Take command to `__VS.ready`)

| Run | base low | work low | base default | work default |
|---|---|---|---|---|
| 1 | 44,538 | 13,493 | 94,370 | 27,288 |
| 2 | 45,746 | 16,477 | 93,445 | 28,617 |
| 3 | 33,370 | 16,157 | 88,061 | 33,059 |
| **median** | **44,538** | **16,157** | **93,445** | **28,617** |

Time inside WebGL compile, link and status calls (median): low 36.8 s to 8.1 s,
default 83.1 s to 17.6 s. Programs linked during a build: low 86 to 63,
default 93 to 67. Console errors 0, page errors 0, failed requests 0,
`__VS.loadErrors` 0 in all 12 runs; every run ended with 32 entities and a
ticking sim.

## Where the time goes: stage table

Wall clock from one loading-card label to the next (this includes the frames
drawn in between, which is where the old build lost its time). Medians of
three runs, grouped into the six stages the new card shows.

| Stage (card row) | Build steps in `main.js` | base low | work low | base default | work default |
|---|---|---|---|---|---|
| Page load to live menu | module load of three.js, engine, shell | 0.8 | 0.8 | 0.8 | 0.8 |
| 1 Hull plating and paint | textures, materials | 0.7 | 0.9 | 2.3 | 3.4 |
| 2 Nebula and sky | environment, sky bake | 3.2 | 1.7 | 3.1 | 3.3 |
| 3 Hulls and keels | `warmShipCache` (procedural hulls) | 3.6 | 3.8 | 2.6 | 2.5 |
| 4 Fleets and orders | FX, sim module, deploy, camera and input | 2.4 | 0.7 | 7.0 | 0.7 |
| 5 Comms and displays | audio, HUD | 1.0 | 0.5 | 2.1 | 0.6 |
| 6 Image and shaders | post stack, wreck moulds, (new) shader queue, first frame | **32.4** | 7.5 | **75.2** | 16.6 |
| Total, Take command to `playing` | | 43.8 | 15.4 | 92.2 | 27.2 |

What the single big number in the old build was: in run 1 at low, "Grading
the image" shows 5.8 s of its own work and then one **27 s long task**
(75 s with a 59.6 s long task at default) before the next label. That task is
the first frame drawn through the new post stack: the render loop kept
drawing behind the opaque loading card all through the build, each frame
compiling whatever had just been added, one program at a time. Every program
compiled before the post stack existed was the direct-to-canvas variant,
which three throws away when rendering moves into the post stack's target,
and compiles again. Stages 4 and 5 were also slower in the old build for the
same reason: the frames in between them were compiling.

In the new build the image stage is mostly the first frame (14.4 to 20.6 s
at default, 1.2 to 7.2 s at low): the software driver has no parallel compile,
so the programs the first frame needs that `renderer.compile()` does not reach
(16 at default, 12 at low: post passes and, at default, shadow depth) still
compile there, one at a time. On this driver the
new "Preparing shaders" step takes under 0.1 s and saves nothing by itself;
the saving comes from not drawing during the build. A test that also queued
the post stack's own materials early (reaching into `PostFX._materials`) moved
10 links ahead of the frame but did not shorten it, so it is not in the patch.

One unexplained difference: the nebula stage ran 1.7 to 4.5 s in work against
2.5 to 3.2 s in base, run to run. It did not show in the medians at default
(3.1 against 3.3) and is well inside the noise of a shared machine, but it is
noted rather than claimed away.

## Progress bar weights

The bar is weighted by these medians (average of low and default): plating
9%, nebula 12%, hulls 17%, fleets and systems 7%, image 55%. The first frame
starts at 48%. On a real GPU the image stage is shorter, so the bar there
runs slow and finishes early rather than the other way round.

## Before and after evidence files

- `data/t-*.json`, `data/summary.json`, `data/timing-batch.log`: the timing batch.
- `data/base-low-probe.json`, `data/base-default-probe.json`: first profiles of base.
- `data/work-firstpaint.json`: page-load check (first contentful paint 724 ms).
- `data/final-work-low.json`, `data/final-work-phone.json`: final verification runs.
