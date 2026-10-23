## FINAL HANDOFF 21 Oct

Written 20 Oct 2026, about 23:15 UK, by usage-burn worker W2 (packet F02), read only on the game. Claude's plan ends about 09:00 UK on 21 Oct. This section is the pickup point for ChatGPT/Codex or a Claude Code cloud session. Every fact below was re-checked tonight with git, gh, a directory listing or Linear, unless it says otherwise. The HOMEWORLD lane wrote no final section of its own; it last updated `STATE.md` on 18 Oct.

### 1. State in one paragraph

**The game is playable today from a local build, but the public site is still the 10 August build.** PR #29 holds every change since 10 Aug (menus, tutorial, options, a victory condition that fires, 12 rounds of visual work) and is open and clean to merge. A ready-to-play copy of its committed head, `262342a` (round 12 fix 2, 18 Oct), sits on the Games share at `G:\VOID-SOVEREIGN\build-2026-10-20-262342a\` and runs with a double-click. https://elusionworks.com/demos/void-sovereign/ returns HTTP 200 (6,234 bytes) but contains no `vs-shell` markup (grep count 0, checked 20 Oct 23:1x), so it is the pre-menu build; `main` is still `ae13feb` (10 Aug, PR #23), and the `/demos/` shelf page has no Void Sovereign card (grep count 0). Kol has not yet played it on the gaming laptop (KOL-6021 is still Todo). The lane's own critic has scored it **5/10 for ten rounds running**; two blind outside passes on 19 and 20 Oct agree (about 5).

### 2. The two PRs, and Kol's merge order

| | PR #29 | PR #27 |
|---|---|---|
| Title | Void Sovereign: menus, tutorial, options, and a contested band that actually exists | Add Void Sovereign to the demo shelf |
| Branch | `feat/void-sovereign-shell` | `feat/void-sovereign-shelf-card` |
| Head SHA | `262342af6b4794eb20aecba71487efeb021ea33f` | `b9cb8fec91f9daf8e77204c19d907a750b287c3c` |
| Commits | **108** (gh API `pulls/29`; `gh pr view --json commits` stops at 100, so do not quote that) | 1 |
| Size | 55 files, +25,085 / -2,576 | 2 files (`demos/index.html`, `demos/void-sovereign/thumbnail.webp`), +20 / -3 |
| Last update | 18 Oct 2026, 19:39 UTC | 10 Aug 2026, 20:28 UTC |
| State | OPEN, not draft, MERGEABLE, merge state CLEAN, base `main` at `ae13feb`, 108 ahead / 0 behind | OPEN, not draft, MERGEABLE, CLEAN, 1 ahead / 0 behind |
| Checks | "Site structure" success on `262342a` | not re-read |

The two PRs touch no file in common, so #27 should stay clean after #29 lands. Other open PRs on the repo, not part of this lane: #32 (KOL-6328, draft) and #15 (KOL-4586).

**Merge order: #29 first, then #27. Kol merges; no agent merges (KOL-6004).**

Check before merging #29:
1. The head is still `262342a`, or, if the round 12 fix 3 work has been committed and pushed by then, the new head is the one you mean to ship. `262342a` does **not** contain fix 3, P44, P46 or P49.
2. Merge state is still CLEAN and the checks are green.
3. Decide about `STATE.md`. PR #29 adds a five-line `STATE.md` at the **repo root**, which GitHub Pages will publish from `main` at elusionworks.com/STATE.md. It holds only lane status text and a Linear link, but it will be public. Accept it, or ask for it to be removed from the branch first.
4. After merging, wait for the Pages workflow run to succeed, then: `curl -s https://elusionworks.com/demos/void-sovereign/ | grep -c vs-shell` returns 1 or more; the title screen loads; a match starts, pauses with Esc and reaches an end screen with zero console errors.

Check before merging #27: it still says MERGEABLE/CLEAN after #29 is in. After merging, the card shows on https://elusionworks.com/demos/ and links to the game.

### 3. Critic history

**Last score: 5/10 overall (lane critic round 11, 13 Oct; axis mean 5.8, the highest yet, the critic declined to round up).** No critic round 12 has run.

| Round | Overall | Axis mean |
|---|---|---|
| 1 | 4 | |
| 2 to 3 | 5 | |
| 4 | 5 | 5.3 |
| 5 | 5 | 5.5 |
| 6 | 5 | 5.4 |
| 7 | 5 | 5.7 |
| 8 | 5 | 5.7 |
| 9 | 5 | 5.5 |
| 10 | 5 | 5.6 |
| 11 | 5 | 5.8 |
| P22 blind pass, 19 Oct (R12 frames) | critic A 5, critic B 4.5 | per-frame R12 5.2 / 4.9 against R6 4.4 / 4.0 |
| P51 blind pass, 20 Oct (H01 build `262342a`) | critic A 5.0, critic B 5.5 | no measurable change at play zoom since R12 |

**Trend:** the overall has been flat at 5 since round 2. The axis mean creeps up (5.3 to 5.8 over rounds 4 to 11). The overall is set holistically by "would a stranger believe this is commercial", anchored on the weakest criteria, so it will not move until no criterion sits at 4. R2 combat legibility was still 4 at round 11.

**Top 5 open findings** (both blind critics raised each one independently unless noted):
1. **Ships, not glyphs (P22 finding 1, P51 finding 1, both passes' number 1).** At play zoom the fleet is cyan diamonds and amber glyphs over grey specks; fighters to frigates are 3 to 10 px. R12 fix 1's hull bars did not move it. P49 is the prepared answer (section 6).
2. **Deaths read as debug geometry, and the whole frame blurs (P22 3, P51 5).** Same cream blob on every class, a "soap bubble" or "lasso" shockwave, and a full-frame smear. P44 found the blur cause (TAA history under the death-camera shake). The uncommitted fix 3 replaces the fireball and the ring.
3. **Player hulls are kitbash boxes (P22 6, P51 4, ranked higher on 20 Oct),** and the title-screen hero ship is not a ship the game has. The hostile bone-and-rust capitals are the best art in the build.
4. **No altitude cues outside the Sensors Manager (P51 3, new; B called it a blocker).** No stalks, drop lines or reference plane in the tactical view.
5. **The HUD does not say who is winning, and its layers collide (P51 6 and 7).** Markers draw over the top bar and objective text; the "First orders" card covers the fleet-hull row.

Still open below the top five: no hard key light on hulls (P22 2), backdrop planets look like primitives (P51 8), seam arc and nebula fight the team colours (P22 4), and round 11's ask to frame the peak wide with 10 or more hostiles and a capital per side. **Closed tonight:** P51's "F01 close-up glitch" is a capture artefact, not a game bug (P59, appended to the 20 Oct FINDINGS.md); no patch is needed.

Reports: `W:\Websites\.vs-pr29\demos\void-sovereign\CRITIQUE-ROUND-1.md` to `CRITIQUE-ROUND-11.md` (committed), `W:\Websites\sites\elusion-works\demos\void-sovereign\.local\fresh-eye-critic-2026-10-19\FINDINGS.md` and `...\.local\fresh-eye-critic-2026-10-20\FINDINGS.md` (not committed).

### 4. Round 12

- **Fix 1, landed `7e25f2d` (pushed):** damaged ships that are engaged or near the camera focus carry a 4-segment hull bar under their contact mark (cyan ours, amber theirs; brighter below half, outlined below 30%; the three lowest pulse). Full damage effects go first to ships under half hull near the focus. Self-test named the three ships nearest death 3/3, but misread the losing side.
- **Fix 2, landed `1b92925` (pushed):** every HUD and end-screen number now counts what its label says (hulls fielded and lost count the same units, queued population labelled, seam % labelled, the pause budget named), plus a new "Fleet hull" row on the HUD and end card. 45 same-instant HUD-vs-sim probes, 0 contradictions. `262342a` is the STATE.md commit after it.
- **Fix 3, NOT committed:** kill-frame detonation with fire, per-class deaths, a soft shock front and the 88 ms first-kill hitch. It sits as uncommitted edits in the `W:\Websites\.vs-pr29` worktree, last touched 18 Oct 21:22. Evidence frames exist (107 `fix3-*` files in `...\.local\shots\R12\`), and harnesses `r12-fix3-death.mjs` and `r12-fix3-sheet.mjs` are in `...\.local\`, but it was never verified by the integrator or committed.

`git status` lists **6 modified files; 5 carry real changes.** The sixth, `src/sim/world.js`, is stat-only: its blob hash equals the index (`828324a`) and its diff is empty, so it is not part of fix 3.

| File (under `demos/void-sovereign/`) | Change | What it does |
|---|---|---|
| `src/fx/explosions.js` | +546 / -282 | Per-class death scripts from a frigate up; one procedural fireball billboard (white-yellow core to dull red edge, stretched along the keel, depth-tested) replacing 14 stacked flare sprites; a soft gas "shock disc" replacing the wire ring; a `warm()` that runs every death script off-field once at boot; `kill()` now returns a break plan |
| `src/fx/index.js` | +11 / -3 | Adds `warmDeaths()` and passes the death script's plan on to the wrecks |
| `src/fx/wrecks.js` | +34 / -13 | Wreck cuts, per-section delays, kick and tumble come from the plan (a destroyer splits at its fireball, a mothership holds until its main detonation); without a plan the R11 behaviour stands |
| `src/main.js` | +5 | Calls `warmDeaths()` inside the "Casting the wreck moulds" boot step, aimed at the 88 ms first-kill hitch |
| `src/render/postfx.js` | +24 | TAA "reactive pixels": a pixel that is mostly FX glow and suddenly much brighter than its history drops its history, so a detonation shows on the kill frame instead of a frame or two later |

**Fix 3 is uncommitted and must be committed or stashed by its owner (the HOMEWORLD lane, or whoever Kol names).** Nobody else should commit, stash, reset or check out in that worktree. Until it is committed and pushed, no cloud session, no PR and no play build can see it. The worktree also holds `stash@{0}` ("R6 fix5 backdrop WIP (unverified)"), parked since 12 Oct; leave it.

### 5. H01 play package

- **Path:** `G:\VOID-SOVEREIGN\build-2026-10-20-262342a\` (the same folder is `\\NAS_Storage_1\Games\VOID-SOVEREIGN\build-2026-10-20-262342a\`). Built 20 Oct 03:14 to 03:16, README updated 04:17. 7.4 MB, 107 files: `PLAY.bat`, `serve.ps1`, `README.txt`, `site\` (a `git archive` of `262342a`) and `proof\` (3 headless screenshots and `verify-log.json`: menu, New game, Continue, Take command, a match running, 0 console, page or request errors). It is the only Void Sovereign build on the share; nothing else for this game is on `G:\`.
- **What it is not:** it does not contain fix 3, P44, P46 or P49.
- **How to run on the gaming laptop:** copy the folder to the laptop (or run it from the share), double-click `PLAY.bat`, keep its small window open. It serves on 127.0.0.1:8765 only, installs nothing, changes no setting, and opens Edge at `http://127.0.0.1:8765/demos/void-sovereign/`. Boot takes up to about 30 s. H shows the controls.
- **A 30-minute play, what to look at:**
  1. First minute: from the title screen, can a first-time player tell what to do? (The original complaint.)
  2. One full standard match: collectors, then frigates, then a destroyer or two; gather the fleet with its capitals and attack. Note how it ends, and whether the end screen's numbers make sense.
  3. In the biggest fight: can you see ships, or only icons? Can you tell who is winning, and which three ships are closest to death?
  4. Let a carrier or cruiser die close to the camera (F to focus): does it feel big, is there a stutter, and does the whole picture blur for a moment (the known P44 issue)?
  5. Frame rate: add `?quality=ultra`, open F12, Ctrl+Shift+P, "frame rendering stats", and read it in the biggest fight at 1080p and at 1440p (target 60 fps at 1440p).
  6. Two other skies: `?seed=99` and `?seed=37`.
  7. Say what first breaks the "commercial game" illusion.
- **Report:** a comment on KOL-6021, or `W:\agent-docs\handoffs\codex-2026-10\HOMEWORLD-CLONE-PLAYTEST-<date>.md`. Results belong in `HANDOFF.md` section 6a.

### 6. Patches waiting

All three live under `W:\Websites\sites\elusion-works\demos\void-sovereign\.local\`, which is the old `feat/void-sovereign` checkout and is gitignored. **They are not in the `.vs-pr29` worktree and do not travel with a clone,** so always give `git apply` the absolute path. Checks below were run read-only tonight (20 Oct 23:13) from `W:\Websites\.vs-pr29`: `--cached` tests against the index, which equals `262342a`; without `--cached` tests against the working tree that holds fix 3. Nothing was applied.

| Patch | Files | `--check --cached` (vs `262342a`) | `--check` (vs worktree with fix 3) |
|---|---|---|---|
| **P49 ships, not glyphs:** `...\.local\p49-legibility\legibility.patch` + `NOTE.md` | 4: `src/fx/engines.js`, `src/ships/catalog.js`, `src/ships/index.js`, `src/ui/select.js` (+157 / -21) | **passes** | **passes** (no overlap with fix 3) |
| **P46 loading screen:** `...\.local\p46-loading\loading-screen.patch` + `NOTE.md`, `timings.md`, `apply-check.txt` | 4: `index.html`, `src/main.js`, `src/ui/shell.js`, `styles/shell.css` (+513 / -37) | **passes** | **fails** on one `src/main.js` hunk at line 693 (fix 3's `warmDeaths` lines sit in the same boot step), as P46's NOTE predicted |
| **P44 death blur:** `...\.local\p44-death-blur\death-blur-fix.patch` + `NOTE.md` | 2: `src/core/camera.js`, `src/render/postfx.js` | **fails** (`camera.js` at 1491) | **fails** (`camera.js` and `postfx.js` at 1227) |

What each does:
- **P49:** raises the impostor hull floor from 9-12 px to 14-18 px, adds team-colour trim strips on distant hulls, adds a short engine wake measured against the hull as drawn, and makes contact glyphs shrink, fade and lift off a hull once it is legible (never for a ship at 30% or less). Matched headless A/B: visible-hull share of the combat region 0.34 to 0.60 at 5.2 km (0.21 to 0.42 and 0.22 to 0.44 at the other fleet-range moments), 0 console errors, no measurable frame-time change. **Unverified on a real GPU and in motion.** Known follow-ups in its NOTE: strips pop at the LOD 1 to 2 switch (fade them above about 35 px), wakes may curl into "commas" on hard turns (try `TRAIL_FAR_HULLS` 1.5), check click picking, and the art owner should agree the strips count as trim.
- **P46:** a real loading card (six measured build stages, a weighted bar, field notes from STORY.md), a "Loading the game systems" strip with dimmed menu buttons until the shell is live, and one `main.js` change that stops drawing the scene behind the opaque card while a match builds. Headless Take-command-to-match: 44.5 to 16.2 s at low, 93.4 to 28.6 s at default. Not checked on a GPU.
- **P44:** keeps the death-camera shake but cuts TAA history feedback from 0.94 to 0.30 while the camera shakes; death frames 2.5x sharper headless. **It was written against `855c469` (old `feat/void-sovereign`), not the PR branch,** so it must be redone by hand on the PR branch (three small edits, all described in its NOTE). Fix 3 also edits the TAA shader in `postfx.js`, so redo P44 after fix 3 is committed.

**How to apply, in this order, on `feat/void-sovereign-shell`, by the owner, one commit each:**
1. Owner commits fix 3 (the 5 files above; leave `world.js` out) and pushes the branch.
2. P49: `git apply --check <abs path>\legibility.patch`, then `git apply` it, run the headless check (section 8), look at the frames, commit, push.
3. P46: `git apply --check` will fail on the one hunk after fix 3. Use `git apply -3 <abs path>\loading-screen.patch`, or apply by hand as its NOTE says: keep fix 3's lines and change only that step's first argument to `0.46` and its closing `});` to `}, 'image');`. Check, commit, push.
4. P44: re-make the three edits on the new head, `git apply --check`, verify, commit, push.

Each patch is "Lane A"-style and parameterised; none adds an asset or a download.

### 7. Next 3 rounds, in priority order

Before round 13: fix 3 committed and pushed (section 4), and its kill-frame claims checked against its own `fix3-*` frames by someone who did not write it.

1. **Round 13: ships, not glyphs (combat legibility, R2 at 4).** Apply P49. Then judge it in motion: a played match on seed 13634 through the peak fight, frames at play zoom (the ordinary zoom, not curated peaks) at 5 and 8 km. Fix the strip pop at the LOD switch, tune wakes if they read as scratches, confirm picking. Add friendly hull bars at combat zoom so "who is winning" reads without the Sensors Manager. Acceptance: a stranger names the losing side and the three ships nearest death on a played wide frame, and both blind critics stop ranking "icons, not ships" first.
2. **Round 14: deaths that read and stay sharp (P3, VFX).** Re-make P44 on top of fix 3 and judge shimmer while the camera shakes. Check each capital class dies differently on the kill frame, the shock front is a soft energy front rather than a ring, and the first carrier kill shows no hitch (frame gap under 50 ms). Apply P46 in this round too, since it shares the `main.js` boot step.
3. **Round 15: player hulls, altitude and HUD layering (art direction, cohesion).** Rebuild the player silhouettes to `ARCHITECTURE.md` section 3 (long, flat, asymmetric; the title-screen ship is the reference), bring a light version of the Sensors altitude stalks into the tactical view for selected ships, and clip world markers below the top bar and keep cards off fixed readouts. Then capture evidence and run critic round 12 plus a third blind pass against P51's frames.

Between rounds: keep one fix at a time, verify every frame by eye, and archive each round's frames under a round-stamped folder before the next run.

### 8. How a Claude Code cloud session or Codex picks this up

- **Repo and branch:** `https://github.com/koltregaskes/elusion-works`, branch `feat/void-sovereign-shell` (PR #29), head `262342a` as of tonight. The game is `demos/void-sovereign/`. Read first: `demos/void-sovereign/HANDOFF.md` (section 5), `ARCHITECTURE.md`, `CRITIQUE-RUBRIC.md`, `CRITIQUE-ROUND-11.md`, `PLAYTEST.md`, then this file.
- **`W:\Websites\.vs-pr29` is local only.** It is a git worktree on the Mini PC's NAS mount (`//NAS_Storage_1/Workspaces/websites/.vs-pr29`), linked to the checkout at `W:\Websites\sites\elusion-works` (which sits on the old, diverged `feat/void-sovereign` branch: never push that branch). A cloud session sees only what is pushed to GitHub.
- **What must be pushed first, by Kol or the lane, before a cloud session can see it:**
  1. Round 12 fix 3: the 5 uncommitted files, committed on `feat/void-sovereign-shell` and pushed. Until then a cloud session starts from fix 2.
  2. The three patches (P44, P46, P49) and their NOTEs: they are in a gitignored folder. Either apply and commit them as in section 6, or copy them onto a side branch that is never merged (for example `handoff/void-sovereign-patches`) and push that.
  3. If the cloud session needs the harnesses (`syntax-check.mjs`, `play-capture.mjs`, `damage-ab.mjs`, `r12-fix*.mjs`, `p49-legibility\harness\`), the same side branch: they are all in gitignored `.local\`.
  4. Never push any of this to `main`, and never commit `.local\` content to the PR branch (Pages would publish it).
- **Run:** from the repo root, `node demos/void-sovereign/tools/dev-server.mjs --port 8900` (serves the repo root with correct `.mjs` MIME; default port 8899; `.claude/launch.json` has a `void-sovereign` configuration on 8900). Open `http://127.0.0.1:8900/demos/void-sovereign/?seed=13634&quality=low`. Useful parameters: `seed`, `quality` (low to ultra), `adaptive=1`.
- **Verify, headless only (the WebGL verification pattern):**
  - Use Playwright with headless Chromium (`npx playwright install chromium`; it renders WebGL through SwiftShader). Do not trust a hidden or background browser tab: it stops `requestAnimationFrame`, so the sim never ticks and frames come back blank.
  - Wait for `window.__VS.ready`, click New game, Continue, Take command, confirm the game reaches `playing` and the sim ticks with entities; require 0 console errors, 0 page errors, 0 failed requests and an empty `__VS.loadErrors`.
  - Syntax-check every module (`node --check` per file, or the lane's `syntax-check.mjs` once pushed), then **look at the frames**: parsing is not rendering.
  - After any camera move, render 0.5 to 1 s at dt 1/60 with every hook, and let CSS fades finish, before taking a shot (P59: a stopped loop plus an instant cut makes fake glitches).
  - Same seed for any A/B. Archive frames per round.
  - On the Mini PC only: take the shared lock `W:\media\opus-5-5-demos\_tools\chrome-lock.mjs` (`withChrome`), wait for about 1.2 GB free RAM, one headless page at a time.

### 9. Rules

- **Never push to `main`.** No force-push. Work reaches `main` only through a PR.
- **Kol merges.** No agent merges #29, #27 or anything else, and no agent publishes.
- **No windowed runs on the Mini PC.** Headless only there; the gaming laptop is the place to look at it in a window.
- Do not commit, stash, reset, check out or gc in `W:\Websites\.vs-pr29` unless you are the named owner of fix 3; leave `stash@{0}` alone.
- No deletion on W: (relocate instead), nothing new on C:, never touch `W:\.env`, no spend, no store submission.
- Keep `.local\` out of every commit. Do not quote any score as a comparison with Homeworld: no blind side-by-side against Homeworld has ever been run.
- Linear: KOL-5966 (lane), KOL-6004 (Kol: merge #29 then #27), KOL-6021 (Kol: laptop play). All three are Todo tonight; this handoff did not change any status.
