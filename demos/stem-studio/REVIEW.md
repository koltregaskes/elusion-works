# Stem Studio: review

Demo 3 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D03).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at and listen to. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** a professional-tool interface where every action is real (edit, undo, save, reload, export) and where an assistant changes the work through a short, checkable plan instead of clicking around.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A browser arrangement view | Four tracks, a bar ruler with sections, clips with a picture of their notes, a playhead and loop | `proof.jpg` |
| Four tracks support note and clip edits | Move, resize, split, duplicate, delete and add clips; a note grid per pattern; pointer and keyboard | `smoke.mjs` |
| Tempo changes | 60 to 180, live during playback | `smoke.mjs` |
| Undo | Every action, one step each; a whole plan is one step; edits that change nothing are not steps | `smoke.mjs` |
| Save and reload | Kept in the browser across a refresh; project files save and reopen | `smoke.mjs` |
| A valid WAV export | 16-bit stereo, 44.1 kHz, same voices and mixer as playback | `smoke.mjs` |
| A fixed eight-bar fixture has the expected length and no clipping | Bars 13 to 20 at 112 bpm render to exactly 844,200 samples (19.143 s with the two-second tail), peak 86% of full scale | `smoke.mjs` |
| Loads stems | Audio files become new tracks; each synth track downloads as its own WAV, in one zip | `smoke.mjs` |
| Lets Claude rearrange them | A plan format with eight moves, checked and applied whole; a brief to copy for Claude; a script interface; a small built-in matcher for a few plain requests | `model.test.mjs`, `smoke.mjs` |
| Own samples or synthesis, no copied interface, no provider calls | All sound is synthesised in the page; the song was written for it; no request leaves the page | Source |

## Checks run (17 Nov 2026)

Verified by running, in Node and in headless Chromium 153.

- `node demos/stem-studio/tools/model.test.mjs`: pass. Edits never change their input and never leave clips overlapping; a split clip sounds the same as before; plans are all-or-nothing with plain errors; sections follow cuts and inserts; hostile and broken project data is cleaned.
- `node demos/stem-studio/tools/smoke.mjs <axe.min.js>`: pass.
  - Clips by pointer and keyboard, notes by keyboard and click, tempo, mute, undo and redo.
  - Survives a refresh; reset is undoable; a project file downloads; a wrong file is refused in plain words.
  - Plans: plain requests, a pasted plan, a plan with one bad move changes nothing, one undo takes a plan back, the script interface, the brief.
  - Sound: the eight-bar fixture, WAV header fields, a loaded stem is in the mix and can be muted, live playback runs, the full song exports (12.4 MB).
  - Untrusted project files: cleaned on the way in, cannot make the page call another site, cannot break a reload.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations on both tabs.
  - Phones at 400 by 800, 320 by 568 and 740 by 360: no sideways overflow, every control on screen and 24 px or larger, level sliders present, taps work.
  - Zero console errors, warnings or failed requests.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **How it sounds.** Nobody has listened. Levels were balanced by measurement (peak and loudness per track), not by ear. The song and voices need Kol's judgement.
- **Real stems.** The stem path was tested with a WAV the studio rendered itself, not with Suno stems or other real files (MP3, FLAC, different sample rates).
- **Claude actually writing a plan.** The brief and plan format were tested with hand-written plans. No model was asked to produce one in this session.
- **Timing on a real machine.** Offline rendering here runs at about real time (software audio in a container). Live timing drift, and export speed on real hardware, are unmeasured.
- **Safari and Firefox.** Only Chromium was run.
- **Kol's Taste Lab rating.**

## Known limits

- Loaded stems are not stretched to the tempo and are not kept in the project file.
- The built-in request matcher is deliberately small. It refuses anything with a "don't" or "keep" in it, and anything where part of the request was not understood, and points to the brief instead.
- Clips move along their own lane only.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the code and the contract but not my conclusions) read the source and ran its own probes, including 3,000 random edits and plans. It found 14 defects my tests had missed. All confirmed ones are fixed, each with a check.

| Finding | Severity | Status |
|---|---|---|
| A project file with a broken pattern was saved before it failed to draw, leaving the page broken after every reload | High, confirmed | Fixed. Files are rebuilt from known fields only, and nothing is saved until it has drawn |
| A crafted project file could make the page load an address on another site | High, confirmed | Fixed. Track kinds are one of five known values |
| Split at playhead ignored the moving playhead | Medium, confirmed | Fixed |
| Deleting bars left section markers in the wrong place | Medium, confirmed | Fixed, and inserts now grow the section they land in |
| A fractional length in a plan could lose clips on reload | Medium, confirmed | Fixed. Whole bars only |
| Absurd values in a file could stall playback | Medium, confirmed | Fixed. Values are clamped and the note search is bounded |
| The position readout announced itself to screen readers 60 times a second | Medium, confirmed | Fixed |
| No level control on phones | Medium, confirmed | Fixed |
| The tempo box could show a tempo the song was not using; no-op edits added undo steps | Low, confirmed | Fixed |
| After a stall, missed notes all played at once | Low, confirmed | Fixed. Missed notes are skipped |
| The request matcher acted on "don't" and on half-understood requests | Low, confirmed | Fixed. It refuses and says why |
| Plans accepted inherited names such as "constructor", and a text "false" as true | Low, confirmed | Fixed |
| A clip could be added past the last bar | Low, confirmed | Fixed |
| Echo did not follow a tempo change; a cancelled drag still moved the clip; a deleted stem kept sounding; stems downloaded as several files; a swipe on a clip could not scroll on phones; focus was lost when undo removed the selected clip | Low, plausible | All fixed |

The reviewer also confirmed: no script injection through file or stem names, no double or dropped notes at scheduling boundaries or loop wraps, a single track really is isolated in stem renders, renders are repeatable, and nothing clips.

Found by my own checks on the way: a dangling `else` in the request matcher; a transport row that ran off the right edge on phones (caught by the repo's overflow rule, not by my first check); a scrolling log keyboard users could not scroll.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 3 and checklist item D03.
- Method: song model first, tested in Node; audio engine checked by offline renders; then the interface; independent review by a second model before sign-off.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
