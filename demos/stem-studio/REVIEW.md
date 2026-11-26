# Stem Studio: review

Demo 3 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D03).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

A draft. Ready for Kol to try and to listen to, but nobody has heard it yet, so it is not finished. Unlisted: not in the gallery, not in the sitemap. Merging the branch would still put it on the live site at its own address, reachable by anyone with the link.

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
| Loads stems | Audio files become new tracks; after a refresh the same file goes back onto its own edited track; each track downloads as its own WAV, in one zip | `smoke.mjs` |
| Lets Claude rearrange them | A plan format with eight moves, checked and applied whole; a brief to copy for Claude; a script interface; a small built-in matcher for a few plain requests | `model.test.mjs`, `smoke.mjs` |
| Own samples or synthesis, no copied interface, no provider calls | All sound is synthesised in the page; the song was written for it; no request leaves the page | Source |

## Checks run (17 Nov 2026, run again after the outside review the same day)

Verified by running, in Node and in headless Chromium 153.

- `node demos/stem-studio/tools/model.test.mjs`: pass. Edits never change their input and never leave clips overlapping; a split clip sounds the same as before, held notes included; Clear never shortens the song; plans are all-or-nothing with plain errors; sections follow cuts and inserts; hostile and broken project data is cleaned.
- `node demos/stem-studio/tools/smoke.mjs <axe.min.js>`: pass.
  - Clips by pointer and keyboard, notes by keyboard and click, tempo, mute, undo and redo.
  - Survives a refresh; reset is undoable; a project file downloads; a wrong file is refused in plain words.
  - Plans: plain requests, a pasted plan, a plan with one bad move changes nothing, one undo takes a plan back, the script interface, the brief.
  - Sound: the eight-bar fixture, WAV header fields, a loaded stem is in the mix and can be muted, live playback runs, the full song exports (12.4 MB).
  - Untrusted project files: cleaned on the way in, cannot make the page call another site, cannot break a reload.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations on both tabs.
  - Phones at 400 by 800, 320 by 568 and 740 by 360: no sideways overflow, header, tab and track controls inside the screen width and 24 px or larger, level sliders present, taps work.
  - Up and down: at 320 by 568, 740 by 360, 640 by 400 (a 1280 by 800 screen at 200% zoom), 400 by 800 and 1280 by 800, with 4 and with 12 tracks, every level slider, the first and last lanes, Play, More, the Clip and Arranger tabs, Add clip, the request box and Apply plan are reached by scrolling with a mouse wheel.
  - Stems after a refresh: the same file, or Load its audio on a missing clip, puts the sound back on the edited track (same tracks, clip positions, offsets and level; rendered level within 1% of before). A file with a new name still makes a new track.
  - Looping one bar inside a 30 s stem: what is scheduled was recorded (source start times, offsets, durations and fade ramps). Each pass lasts exactly the loop, starts at the same point in the stem, ends before the next starts, and fades out over 5 ms at the wrap. This checks the timing, not the sound.
  - A stem zip renders one version of the song even when the tempo is changed while it renders.
  - With Web Audio removed, Play says the browser cannot play sound; with storage failing, the page says once that changes are not being kept.
  - In a browser started without the autoplay override, a click on Play starts the clock.
  - Zero console errors, warnings or failed requests.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present (49 indexable routes, unchanged).

## Not verified

- **How it sounds.** Nobody has listened. Levels were balanced by measurement (peak and loudness per track), not by ear. The song and voices need Kol's judgement.
- **Real stems.** The stem path was tested with WAVs the studio rendered itself and plain sine-tone WAVs the test builds, not with Suno stems or other real files (MP3, FLAC, different sample rates).
- **Claude actually writing a plan.** The brief and plan format were tested with hand-written plans. No model was asked to produce one in this session.
- **Timing on a real machine.** Offline rendering here runs at about real time (software audio in a container). Live timing drift, and export speed on real hardware, are unmeasured.
- **Safari and Firefox.** Only Chromium was run.
- **Clicks at loop wraps.** The 5 ms fades are scheduled and checked as numbers. Whether a wrap is silent to the ear is unheard.
- **Real phones and real zoom.** Short screens and 200% zoom were checked as small browser windows, not on devices or with the browser's zoom control. The styles set text sizes in pixels, so a browser text-size setting on its own does not enlarge the page (read from the styles, not tried); browser zoom does.
- **Loudness.** Peak and RMS are measured; integrated loudness (LUFS) and true peak are not, and no target level has been chosen.
- **Kol's Taste Lab rating.**

## Known limits

- Loaded stems are not stretched to the tempo and are not kept in the project file. After reopening, the audio must be loaded again; it then goes back onto its own track.
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

## Outside review

Reviewed on 17 November 2026 by ChatGPT in chat mode at Pro, driven by another Claude session at Kol's request. It read the code, tests and pictures and did not run the page. Score 6/10, verdict HOLD. Each finding was then checked here by running the page or the model, not taken on trust.

| Finding | What was done | Held by |
|---|---|---|
| After a refresh, loading a missing stem again makes a new track at bar 1; the edited track stays silent | True: reproduced (5 tracks became 6, the moved clip stayed marked missing). Fixed: a file with the same name, or one chosen with the new Load its audio button on a missing clip, goes back onto that track. Clips, offsets, levels and undo history are untouched | `smoke.mjs` stems check |
| A long stem in a short loop keeps playing past the loop end and stacks copies at every wrap | True: on a one-bar loop at 180 bpm (1.333 s) each pass was scheduled for 4 s, so copies overlapped. Fixed: loaded audio stops at the loop end (and at the end of an export range) with a 5 ms fade where it is cut part-way. After a tempo change during playback the stop moves with the loop end | `smoke.mjs` loop check (scheduled times, not listening) |
| Short screens and large text cannot reach every track and control vertically; page overflow is hidden | True: with the old layout and the new check, at 320 by 568 Add clip, the request box and Apply plan could not be scrolled to; at 740 by 360 and at 640 by 400 the Lead level, the last lane, the tabs and Add clip could not; at 1280 by 800 with 12 tracks the last lane, the tabs and the whole editor could not. Fixed: the lanes scroll up and down inside their area and the editor keeps at least 190 px; on screens 600 px tall or less the whole page scrolls | `smoke.mjs` reach check, 4 and 12 tracks, five sizes |
| Splitting can shorten a held note | True in the code: a note held across the split point was cut at the split and not continued. Not audible in the demo song as shipped (none of its notes crosses a bar line), but any note you add that does was cut. Fixed: a note rings on when the next clip carries straight on with the same notes in step | `model.test.mjs` (worked by hand: a whole-bar note from step 9 lasts 4 beats, before and after the split) |
| Clear can shorten the song | True: clearing all tracks in bars 25 to 32 made a 24-bar song with the Last chorus marker past the end. Fixed: only Delete shortens the song; Insert grows it by its length | `model.test.mjs` |
| A stem zip can mix two versions if the song is edited while it renders | True by the code path (each track re-read the song after waiting). Fixed: one snapshot of the song and the loaded audio is taken at the start | `smoke.mjs` (tempo changed mid-render, both files are the 112 bpm length) |
| Mobile tests check only sideways overflow | True. Added the up-and-down reach check above | `smoke.mjs` |
| axe is optional in the browser test | True. The test now fails without it | `smoke.mjs` |
| The browser test uses an autoplay override | True. Added one check in a browser without it: a click on Play starts the clock. The rest still uses the override | `smoke.mjs` |
| Autosave failures are swallowed | True. The page now says once that changes are not being kept and points to Save project file | `smoke.mjs` |
| No handled fallback when Web Audio is missing | True: Play threw an uncaught error. Play now says sound is not available; note previews fail quietly. Export still shows a plain error message from the browser | `smoke.mjs` |
| "Every control on screen" was not shown by the checks | True: the old check covered sideways position only. The wording above now says what each check covers | This file |
| "Ready for Kol" claims more than the evidence | Fair. The verdict now says draft and unheard | This file, `README.md` |
| No console errors: could not tell | Run here: zero console errors, warnings or failed requests across the browser test | `smoke.mjs` |
| Reference comparisons, a 20-second recording, a 1440 px reference pair | Not done. Choosing references and judging against them needs Kol | None |
| Whole track heard on headphones and a phone; clicks and dropouts by ear | Not done. Sound cannot be heard on this machine | None |
| Loudness (LUFS) and true peak | Not done. No target level has been chosen; peak and RMS only | None |
| Phone load time on 4G under three seconds | Not done. Cannot be measured here | None |
| Safari, Firefox, real Suno stems, a plan written by Claude | Not done. Only Chromium is installed here; no real stems or model calls in this session | None |

### Fix check, 18 November 2026

The same outside reviewer read the fixes above the next morning and moved its score from 6 to 7 out of 10, still HOLD. It found two more faults, both real.

| Finding | What was done | Held by |
|---|---|---|
| A change of tempo while a stem is sounding in a loop was still wrong. The stop was moved but the stem's length and fade were fixed when it started: slowing down left it silent from its old stop to the new one, and speeding up cut it off without its fade | True. Live, a stem is now started with no fixed length and stopped apart, and a change of tempo moves the stop and the fade together. An edit that leaves the tempo alone does not touch a sounding stem | `audio.test.mjs`, new: the sums worked by hand (120 to 60 bpm one second into a two-bar clip stops at 7 s, not 4; 120 to 240 stops at 2.5 s, with its fade). Browser check: in mid loop, slower moves the stop later and faster sooner, each with a fade at the new stop. Not heard |
| A comment written part way along a line had swallowed the call that keeps the sections in order after a plan | True. The call is restored. With the requests the arranger understands today the sections did not in fact get out of order, so nothing visible had gone wrong | `model.test.mjs`: sections handed over in reverse come back in the order of the song |
| Reaching controls by touch, by keyboard and at real browser zoom is unproved; nobody has listened | Still true. Listed under Not verified | |

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 3 and checklist item D03.
- Method: song model first, tested in Node; audio engine checked by offline renders; then the interface; independent review by a second model before sign-off.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
