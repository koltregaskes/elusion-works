# The Catch Is You: review

Demo 6 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876, checklist item D08).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to watch. Not published, not in the gallery, not in the sitemap.

**Quality bar it sets:** an explainer that is all argument and no filler: the essay's own words, set as type on a beat, in Kol's title-card look, with a transcript that drives the film, and a project small enough to edit and render again.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| An essay turned into an explainer video | "AI's Efficiency Promise Has a Catch - You" (published on Kol's Korner, 12 February 2026) as a film of 1 minute 34 seconds | `efficiency-catch.mp4`, `proof.jpg` |
| Made with HyperFrames | A HyperFrames project of seven scenes, one file each; its own checker passes with no errors and no warnings; rendered with its command line | `tools/film/` |
| Kol's taste: title-card style, comic-book touches, not a glossy generic look | Charcoal ground, white type, one green; a starburst, speech bubbles and dots, used sparingly | `proof.jpg` |
| Faithful to the essay | All 39 sentences on screen are word-for-word extracts; the check fails otherwise | `tools/check.mjs` |

## Checks run (17 Nov 2026)

Verified by running, in Node, with ffmpeg, in HyperFrames 0.9.61 and in headless Chromium 153.

- `npm run check` in `tools/film` (HyperFrames' checker): pass, 0 errors, 0 warnings. It covers structure, runtime errors, layout (no overlaps or clipping), contrast (30 of 30 text checks pass), reading time and sound. Its motion pass did not run in this setup, so no claim is made for it.
- `node demos/efficiency-catch/tools/check.mjs`: pass.
  - The file: H.264, 1920 by 1080, 30 frames a second, 93.6 s, 8.9 MB, index at the front; AAC sound at -22.9 LUFS peaking -4.6 dBFS; 15 frames from across the film are neither flat nor repeats.
  - The transcript's 23 lines match the page and the scenes both ways, and each line's time is the moment its words are told to appear in the scene's source.
  - Seven scenes start on 2.4 s bars. The six accents are on the beat, and in the finished sound each is at least 3.7 dB above the same beat one bar earlier.
  - All 39 sentences are in the essay word for word.
- `node demos/efficiency-catch/tools/smoke.mjs <axe.min.js>`: pass.
  - The film loads, is named, and waits to be played. Every time button has its own name and its line as its description.
  - Pressing a time (mouse, keyboard, touch) plays from that line. The line being shown is marked, by colour and for screen readers, at the start, between close lines, and at the end.
  - Frames decode in the browser and differ from scene to scene.
  - Phones at 400 by 800, 320 by 568 and 740 by 360: nothing off the side; the film keeps its shape.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations at four sizes. Zero console errors; no request leaves the page.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present. The `tools` folder is not in the built site.

## Not verified

- **Nobody has watched it at speed or listened to it.** Frames were looked at as stills; the music was checked by measurement. Pace, rhythm and whether the music is pleasant need Kol.
- **Whether it is what Kol would have cut.** The film keeps the essay's argument and its closing warning, but which lines to keep is a judgement.
- **Playback on phones and in Safari and Firefox.** Only Chromium was run. The file is plain H.264 and AAC, which every current browser plays.
- **A real screen reader.** Names, descriptions and the current-line mark were checked in the page, not heard.
- **Kol's Taste Lab rating.**

## Known limits

- Music only, no voice. A narrated version would need a voice Kol approves; nothing was generated.
- The render is the same every time on one machine. A different machine can differ by a few invisible pixels.
- The film is 9 MB in the repository. Each new render adds that much to the repository's history.
- With JavaScript off, the film and the full transcript are still there; the time buttons are inert and say nothing.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the files and the contract but not my conclusions) read the essay, looked at the film frame by frame at every scene change and transcript time, analysed the sound, rendered the project twice, and probed the page. Both of my check files passed at the time; it found 14 things. All are dealt with.

| Finding | Severity | Status |
|---|---|---|
| The Jevons line was reworded ("Better engines didn't use less coal. They used more.") in a way that changed the essay's meaning, and was described as a cut | Medium, judgement | Fixed. The film now uses the essay's words: "Coal-fired engines didn't reduce coal consumption. Consumption exploded." Every line is now an extract, and the copy says so |
| The essay check only ran if a setting was given, and "34 of 38 exact" was looser than it sounded | Medium, confirmed | Fixed. The essay is bundled and the check always runs; the claim is now "word-for-word extracts", which is what is tested |
| The accent check could pass with a line moved off its accent, and never looked at the sound | Medium, confirmed | Fixed. Times are read from the animation calls themselves, and the accents are measured in the film's sound |
| The page claimed the checker covered motion; that pass had not run | Medium, confirmed | Fixed. The claim is dropped |
| The README said only three files are published; four pictures are too | Medium, confirmed | Fixed. They are listed |
| The README pointed at a review file that did not exist | Medium, confirmed | This file |
| The fonts' licence text was a summary, not the licence | Low to medium, confirmed | Fixed. Each font's full licence is beside it |
| README commands in the wrong order (render before remaking the music) | Low to medium, confirmed | Fixed |
| Two cuts lost context: who says "yes, and I've already allocated that capacity", and the essay's warning about roles built on speed | Low to medium, judgement | Fixed. Both are back, in the essay's words, which lengthened the film by 7 seconds |
| Screen-reader gaps: two buttons with one name, no link from a button to its line, current line shown by colour only, unnamed video | Low, confirmed | Fixed. Tested |
| The shipped file differed slightly from a fresh render | Low, confirmed | Fixed. Re-rendered with the documented command |
| The accent at 24 s could not be heard | Low, confirmed | Fixed. It is now tested for, with the other five |
| Design: an empty beat at each scene change, a bare axis for half a second, dots under the footer, a floating label, a long still end card | Low, judgement | Fixed. Scenes now start on their first frame; the label sits by its bar; the end card has a slow line drawing under the credit |
| Small copy and test gaps (a missing word, a note that was false with scripts off, untested marking at the start and end) | Low, confirmed | Fixed |

It confirmed as sound: the file format and index position; no black, frozen or half-drawn frames, including the frame either side of every scene change; no clipping and a clean ending; the music script reproduces the music exactly, so nothing is borrowed; all transcript times against the film itself; two renders identical; nothing autoplays; no outside requests; the page works under the built site's script rules; "no stock footage, no generated images" holds.

Found by my own checks on the way: a leftover call that silently stopped every animation (caught by the checker reporting still frames); a line landing off the beat while the page said it was on it; a claim that every word was the essay's when four lines were not.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 6 and checklist item D08.
- Method: essay chosen from the published ones; script cut to the essay's own sentences; scenes written as a HyperFrames project and checked with its tool; music synthesised; rendered locally; independent review by a second model; fixes with wider checks.
- Tools: HyperFrames 0.9.61 (local, open source, no account used), GSAP 3.15.0, ffmpeg.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
