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

## Checks run (17 Nov 2026, run again after the outside review)

Verified by running, in Node, with ffmpeg, in HyperFrames 0.9.61 and in headless Chromium 153.

- `npm run check` in `tools/film` (HyperFrames' checker): pass, 0 errors, 0 warnings. It covers structure, runtime errors, layout (no overlaps or clipping), contrast (30 of 30 text checks pass), reading time and sound. Its motion pass did not run in this setup, so no claim is made for it.
- `node demos/efficiency-catch/tools/check.mjs`: pass.
  - The file: H.264, 1920 by 1080, 30 frames a second, 93.6 s, 8.9 MB, index at the front; AAC sound at -22.9 LUFS peaking -4.6 dBFS; 15 frames from across the film are neither flat nor repeats.
  - The transcript's 23 lines match the page and the scenes both ways, and each line's time is the moment its words are told to appear in the scene's source.
  - Each line's words belong to elements told to appear inside that line's own slot (from its time to the next line's), not just somewhere in the scene. A copy with two lines in scene 3 swapped passes the old check and fails this one.
  - Seven scenes start on 2.4 s bars. The six accents are on the beat, and in the finished sound each is at least 3.7 dB above the same beat one bar earlier.
  - All 39 sentences are in the essay word for word.
- `node demos/efficiency-catch/tools/smoke.mjs <axe.min.js>`: pass.
  - The film loads, is named, and waits to be played. Every time button has its own name and its line as its description.
  - Pressing a time (mouse, keyboard, touch) plays from that line. The line being shown is marked, by colour and for screen readers, at the start, between close lines, and at the end.
  - Pressing a late time from the bottom of the page brings the film on screen before it starts playing, at 1280 by 800 (keyboard and mouse) and on the three phone sizes (touch); keyboard focus stays on the pressed time. With reduced motion asked for, the page jumps instead of gliding.
  - If the browser refuses to play, a message with a Try again button appears, the transcript stays, and the message clears once the film plays. If the film file cannot be fetched, the page says so.
  - The links home, the sharing details and `noindex` are there; the note about small text shows on phones only.
  - Frames decode in the browser and differ from scene to scene.
  - Phones at 400 by 800, 320 by 568 and 740 by 360: nothing off the side; the film keeps its shape.
  - axe-core 4.14.0, WCAG 2.2 A and AA: 0 violations at four sizes. Zero console errors; no request leaves the page.
- The repo's own overflow rule and axe at 320, 390 and 1280 px: clean.
- `python3 scripts/build-site.py`: pass with the demo present. The `tools` folder is not in the built site.

## Not verified

- **Nobody has watched it at speed or listened to it.** Frames were looked at as stills; the music was checked by measurement. Pace, rhythm and whether the music is pleasant need Kol.
- **Whether it is what Kol would have cut.** The film keeps the essay's argument and its closing warning, but which lines to keep is a judgement.
- **Playback on phones and in Safari and Firefox.** Only Chromium was run. The file is plain H.264 and AAC, which every current browser plays.
- **A real screen reader.** Names, descriptions, the current-line mark and the problem message were checked in the page, not heard.
- **How small the film's text really looks on a phone.** The outside review's sizes (about 7 px at 320 px wide, 9 px at 390 px) are worked out from the page's layout, not measured on a device. The page now says so and points to full screen and the transcript; the film itself is unchanged.
- **The scroll to the film on a real phone or in Safari and Firefox.** Checked in headless Chromium only.
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

## Outside review

ChatGPT in chat mode at Pro, driven by another Claude session at Kol's request, reviewed commit `e3662c0` on 17 November 2026. It read the code, the review notes and the pictures; it did not run the page, watch the film or hear it. It scored the demo 6.5 out of 10 and said HOLD. Claude Fable 5.2 then checked each finding against the code and in a browser, and fixed the ones that were true and could be fixed and checked here.

| Finding | What was done | Held by |
|---|---|---|
| The film has not been watched and heard end to end by an independent reviewer able to do so, and the earlier reviewer was also a Claude model | True. Not done: no model here can watch or listen as a person does. It still needs Kol, or another person, on a desktop and a real phone | Not verified, above |
| Explanatory text is tiny on phones: scene 6's 48 px lines become about 7 px at 320 px wide and 9 px at 390 px | True by the same sum (the film box is 278 px wide at 320, so 48 x 278 / 1920 = 7). The film was not changed: a phone version of the film is a redesign and a new render. The page now says, on phones only, that the smaller lines are hard to read upright and points to full screen sideways and to the transcript | `smoke.mjs` (the note shows on phones, not on desktop) |
| Pressing a transcript time plays the film off screen | True: the old handler seeked and played without moving the page. Now the film is brought on screen first (smoothly, or by a jump when reduced motion is asked for, or a jump if a slow device has not finished the glide in 1.2 s), and only then plays. Focus stays on the pressed time | `smoke.mjs`: late times by keyboard, mouse and touch at four sizes, with the film's position recorded at the moment it starts playing; reduced motion |
| The site's CI does not run this demo's film and playback checks | True. Not done: the brief for this pass does not allow changes outside the demo's folder. Wiring `check.mjs` and `smoke.mjs` into CI is for Kol to decide | Not done |
| `check.mjs` only proves some animation starts at each time and the words are somewhere in the scene | True. Added a tighter check: each line's words must belong to elements told to appear between that line's time and the next line's | `check.mjs`; a copy with two lines swapped passes the old check and fails the new one |
| The 1x and 2x graphics should be labelled illustrative, the piece presented as an opinion essay, and the original essay linked | True. The page now calls it an opinion essay, says it is one person's argument, says the 1x and 2x bars and meters illustrate the essay's example and are not measured data, and links to Kol's Korner. The essay's own address was not linked because it could not be confirmed from here, so the link goes to the site's home page | Read in `index.html` |
| Playback failures are swallowed | True: `.catch(() => {})`. Now a refused play or a film that cannot be fetched shows a message, with a Try again button, and points to the transcript | `smoke.mjs`: play refused, then allowed; film file blocked |
| No links back to Elusion Works or to the film's source; no sharing details | True. Added a breadcrumb (Elusion Works, Demos), a link to the site's repository, where the film's source will be once this is merged (the `tools` folder is not served). A first version linked straight to the source folder, which does not exist until the merge, and the site's own link check refused it, and Open Graph details using the poster as the picture. `noindex` kept | `smoke.mjs` (links, sharing details, `noindex`); site build privacy check |
| The thumbnail shows a loading spinner | True. `shots.mjs` now waits until the browser has enough of the film before taking pictures; all three pictures were taken again and looked at | The pictures |

Found on the way, not raised by the outside review: the page's lede used an en dash in the essay's title, where the essay uses a hyphen; it is now a hyphen. The film's end credit (scene 7) still has that en dash, burned into the picture; changing it means a new render, which was not done. A smoke check that compares frames from different scenes failed once when the machine was very busy and passed on the runs after; it is the old check, unchanged.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 6 and checklist item D08.
- Method: essay chosen from the published ones; script cut to the essay's own sentences; scenes written as a HyperFrames project and checked with its tool; music synthesised; rendered locally; independent review by a second model; fixes with wider checks.
- Tools: HyperFrames 0.9.61 (local, open source, no account used), GSAP 3.15.0, ffmpeg.
- Release steps when approved: remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
