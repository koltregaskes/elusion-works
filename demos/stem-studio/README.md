# Stem Studio

A browser arrangement room an assistant can drive. Demo 3 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Quality bar it sets:** a professional-tool interface where every action is real (edit, undo, save, reload, export) and where an assistant changes the work through a short, checkable plan instead of clicking around.
Use it as the reference for tool interfaces and audio.

## What it does

- Four synth tracks (drums, bass, keys, lead) play "Night Bus Home", a 32-bar song in A minor written for this page.
- Clips move, resize, split, duplicate and delete, by pointer or keyboard. Clips on a track never overlap: an edit trims or splits what it lands on.
- A note editor for the pattern behind each clip, with a keyboard cursor. Patterns are shared between clips until you press Make unique.
- Tempo from 60 to 180, level, mute and solo per track.
- Undo and redo for everything. The song is kept in the browser and survives a refresh. Project files save and reopen.
- Export WAV renders the whole song faster than it plays, with the same voices and mixer as playback, and never clips.
- Stems: load audio files as new tracks, or download each track as its own WAV. After a refresh or a reopened project, a stem's clips show as missing; loading the same file again (or Load its audio on a missing clip) puts the sound back on that track, with its edits kept.

## Built for an assistant

An arrangement change is a plan: `{"ops":[...]}`, a list of moves.

| Move | Fields |
|---|---|
| `set_tempo` | `bpm` |
| `clear` | `track` (or `"all"`), and `from`/`to` bars or a `section` |
| `copy` | `from`/`to` or `section`, `at`, optional `tracks` |
| `insert` | `from`/`to` or `section`, `at` (later bars move along) |
| `delete` | `from`/`to` or `section` (later bars close the gap) |
| `add_clip` | `track`, `pattern`, `at`, `bars` |
| `set_level` | `track`, `level` |
| `mute` | `track`, `on` |

Bars are counted from 1 and ranges include both ends. A plan is checked first, applied whole or not at all, described back in plain sentences, and undone in one step.

Three ways in:

1. **The request box.** It understands a few phrasings by itself ("drop the drums in the break", "double the chorus", "cut the intro", "keys only in the intro", "faster", "120 bpm"). This is a small scripted matcher, not an AI model, and it says so when it does not understand.
2. **Copy the brief for Claude.** The brief describes the song, the moves and your request. Paste Claude's JSON reply into the plan box.
3. **`window.stemStudio`** for scripts and agents: `project()`, `brief(request)`, `apply(plan)`, `ask(text)`, `undo()`, `redo()`, `loadStem(name, bytes, track)` (the track is optional: give it to put audio back on a track whose audio is missing), `render(fromBar, toBar, only)`, `state()`.

No request leaves the page. There are no provider calls.

## Limits

- Loaded stems play as recorded, at their own speed. They are not stretched to the project tempo and are not stored in the project file, so load them again after reopening: a file with the same name, or one chosen with Load its audio, goes back onto its own track.
- The synth voices are simple by design. This is an arrangement tool, not a sound-design one.
- The song is original to this page. No Suno audio or other third-party audio is bundled.

## Credits

Idea after Alex's AI-native music workstation (https://x.com/The_Alex/status/2119917226769985785). A separate, original build: its own song, sounds, interface and plan format.

## Files

- `index.html`: page and styles.
- `js/model.js`: the song as data. Edits, plans, the request matcher and loading. Pure functions.
- `js/audio.js`: voices, mixer, scheduler, offline render and the WAV encoder.
- `js/app.js`: the interface.
- `tools/`: checks (not shipped). `model.test.mjs` needs only Node: `node demos/stem-studio/tools/model.test.mjs`. `smoke.mjs` and `shots.mjs` need Playwright and a static server serving the repo root (set `BASE`); `smoke.mjs` also needs the path to `axe.min.js` as its first argument: `BASE=http://127.0.0.1:8765 node demos/stem-studio/tools/smoke.mjs node_modules/axe-core/axe.min.js`. It takes several minutes.

## Status

Unlisted, and a draft. The page carries `noindex` and is not in the gallery or the sitemap. Nobody has listened to it yet.

Merging this branch puts the page on the live site at its own address (`/demos/stem-studio/`), because the site deploys whatever is merged. It would be unlisted, but anyone with the link could open it. To release it: remove the `noindex` line, add the gallery card in `demos/index.html` and the route in `sitemap.xml`. Kol approves publishing.
