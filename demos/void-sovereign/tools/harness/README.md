# Void Sovereign headless harnesses

Evidence tools for critic rounds, written for a machine with **no GPU** (a cloud
container). Chromium renders WebGL through SwiftShader at about one frame a second
there, so every harness stops the game loop and steps frames by hand at a fixed
1/60 s. A frame is then exactly what the game would draw at 60 fps, whatever the
host speed, and two builds reach the same sim state at the same tick.

Start the dev server from the repo root first (one per build you compare, on its
own port, for example from a `git worktree` of the older commit):

    node demos/void-sovereign/tools/dev-server.mjs --port 8901

| Script | What it makes |
|---|---|
| `death-step.mjs --kind carrier --out <prefix>` | One hostile hull 9 km above the field, scripted hits, the kill, frames at 0 to 217 ms and +0.3/+1/+1.5/+3 s, a strip, per-frame CPU ms, GL compile/link/upload counts, kill-frame flash box against the hull box. Kinds: interceptor, frigate, destroyer, cruiser, carrier, mothership. `--profile` adds a CPU profile round +1.5 s. |
| `battle-step.mjs --out <prefix>` | Two 21-hull fleets attack-moving 9 km above the field, framed at 5.2, 2 and 8 km; canvas and HUD frames; a hash of hull positions per moment proves two builds match. |
| `played-step.mjs --out <prefix> [--tick 5941]` | AI against AI (a Commander added to the player's side), fast-forwarded to a tick, framed wide / mid / close by the game's own focus camera, with an answer key (nearest death, hulls in frame). |
| `boot-click.mjs --out <prefix>` | The real menu flow (New game, Continue, Take command), timed to a live match, with loading-card screenshots. |
| `lineup.mjs --out <dir>` | One ship per class and team, alone, from a fixed 3/4 view. |
| `sharp.py <prefixA> <prefixB>` | Contrast-free sharpness away from the blast on death-step frames (P44's metric). |
| `crop.py out.png scale x0 y0 x1 y1 in...` | Labelled side-by-side crops. |

Common options: `--base http://127.0.0.1:8901`, `--q low|medium|high|ultra`,
`--w`/`--h` viewport. All need Playwright (local or global) and use the Chromium it
finds. 0 console, page and request errors is part of every result; read the JSON.

Frame timings from SwiftShader are CPU-side only. GPU frame time and anything felt
in motion must be checked on a real GPU.
