# Rooms OS house theme: review

Demo 10 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try. Not published, not installed anywhere, not in the gallery or the sitemap.

**Nobody has seen this theme in a Claude app.** It was built and checked without one. Everything that can be checked from outside passes; how it looks is unproved. Treat the first look as part of the review.

**Quality bar it sets:** a theme that is data, with one source for its colours and its scene; checked by Claude Code's own validator, type check and test runner, and by a preview page that reads the same files and works out every contrast figure it prints a second way.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A Rooms OS house theme for Claude desktop | A Claude Code mod that sets a look for the desktop and mobile apps: colours for both halves of the day and a scene behind the conversation | `mod/` |
| House style: charcoal, white ink, one green | Night page `#111315`, ink `#f4f5f3`, accent seed `#3fe08a`. Buttons come out a deeper green, because the apps set the lightness; the page and README say so | `mod/hooks/house.js`, the table on the page |
| After the ClaudeDevs post, original | Own colours, own drawing; credit and link on the page; says it is not made by or with Anthropic; no logo, artwork or font of anyone's | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. None of these is the apps.

- `claude plugin validate demos/rooms-os-theme/mod`: passes. It notes only that there is no licence file or icon, which matter for the plugin directory.
- `claude plugin test demos/rooms-os-theme/mod`: 4 of 4 pass.
  - Starting a session sets the whole look once, with both halves of the day and the scene.
  - Where no look is drawn, the reason goes to the status line.
  - The scene is drawn through the engine on the desktop and mobile surfaces, and another mod's scene is left alone.
  - The drawing is small, pure vector, slow, pinned to the corner, and has one room resting lit.
- Type check (`tsc` with the settings the toolkit gives): clean.
- `node demos/rooms-os-theme/tools/palette.test.mjs`: pass.
  - Nothing the apps would refuse. Night half: no notes from the colour maker. Day half: 25, each within 0.12 of its bar.
  - Main ink at 7 to 1 or better on every surface, quiet ink at 4.5 to 1, in both halves. Cards can be told from the page in both.
  - Each role reads as words and as a fill. The five roles are at least 30 degrees of hue apart as words, measured in OKLCH on the shades the theme yields.
  - The six rooms tile the plan exactly. Every door's swing is a true quarter circle.
  - Where the plan lands at eight screen shapes from 320 by 568 to 2560 by 1080: always whole, always in the top right corner and the top quarter, clear of a middle column of words on wide windows.
  - The scene's grey and green show on both grounds; words over a lit room still read at 7 to 1.
  - `make-colors.js` carries the toolkit's own checksum line.
- `node demos/rooms-os-theme/tools/smoke.mjs`: pass.
  - The specimen is painted with the theme's own colours; 41 pieces of text in it read at 4.5 to 1 or better against what is really behind them, in both halves.
  - The table's 17 rows: every ratio is the one a second copy of the sum gives.
  - The lights move (first room lit at 5 s, dark again by 14 s), can be held still, and start still when motion is to be kept down.
  - Five window sizes, no scripts, axe WCAG 2.2 A and AA, no console errors, no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; Tab lands on visible things; `python3 scripts/build-site.py` passes.

## Not verified: the first things to look at in the apps

1. Does it paint at all, in both halves of the day?
2. A phone held upright: is the plan there in the top right corner, and do its rooms light?
3. What shows through the scene, which paints no ground of its own, on desktop and on mobile.
4. Desktop at about 1440 wide with the side bar open: is the plan clear of the words?
5. A long code block: are keywords (green) and strings (lime) told apart?
6. The day half: can cards and panels be told from the page?
7. Buttons: is the deeper green acceptable as the house green?
8. A larger text size, and reduce motion: does one room rest lit?

Also not checked: Safari and Firefox for the preview page; a real screen reader; how a session started in a terminal is opened in an app.

## Known limits

- The house green is the seed, not the button colour. See above and the README.
- The scene is small and in one corner. An earlier version drew a plan across the whole ground; the review showed it put lit rooms behind the words on some screens and showed none at all on a phone.
- The day half's 25 notes are the price of paper that is tinted and surfaces that can be told apart.

## Independent review

A second model (Claude Opus 5.5, fresh context, given the files, the toolkit's own rules and the contract, but not my conclusions) read the mod against the toolkit, compared the copied colour maker byte for byte, recomputed every figure on the page, worked out what the scene shows at four screen shapes and looked at pictures of each. All my checks passed at the time; it found 13 things.

| Finding | Severity | Status |
|---|---|---|
| On a phone held upright the scene never showed a lit room: the crop kept only the two rooms that never light | Should fix (the main defect) | Fixed. The scene is redrawn: a small plan pinned to the top right corner by the toolkit's own method, whole at every shape. Checked at eight shapes |
| Lit rooms sat behind the words and the message box on a phone on its side and at the edges of the column on a desktop; my test's idea of "the middle" was wrong | Should fix | Fixed by the same redrawing. The test now works out where the plan lands on real screens |
| The accent and success greens were nearly the same as words in code (20 degrees apart, same lightness); my test measured hue in a way that flattered the gap | Should fix | Fixed. Success is a lime, 34 degrees from the accent by night and 37 by day; the test measures in OKLCH on the shades the theme yields |
| The page did not say that its shade for coloured words is its own choice | Should fix | Fixed. A line under the table says so |
| README: pointed at a review file that did not exist; overclaimed ("the apps' own validator", "the reference for Claude app themes") | Should fix | Fixed. This file; the claims are narrowed to what was run. The first name and the demo number stay, as in the other nine demos' READMEs |
| The scene paints no ground, so what shows through is unknown | Uncertain | Not changed: painting a ground would need the scene to know the half of the day, which is the thing in doubt on mobile. Listed as a limit and as the third thing to look at |
| On mobile the scene might follow the phone's setting, not the app's | Minor | Fixed by removing the question: the scene's colours no longer depend on the half of the day |
| The day half was barely a second version: near-white, cards invisible | Should fix | Fixed. Cool blueprint paper with steps between surfaces, at the cost of 13 more near-miss notes. The night half is left as it was: the toolkit asks for night surfaces to stay close |
| Buttons will not read as the house green | Should fix, or say so | Said plainly on the page, in the README and here. Not changed: the alternative makes switches hard to read |
| "Trying it" left out three things about the setting, and was unclear about terminal sessions | Minor | Fixed. All three are stated; the unclear part is stated as unknown |
| The mod's own name was written into the code | Minor | Fixed. It reads its name from the engine |
| With scripts off, dead buttons and an empty table showed | Minor | Fixed and tested |
| Drawing details: walls not broken at doors, shared walls drawn twice, a doubled line | Minor | Fixed in the redrawing. Walls are drawn once and broken at each door |

It confirmed as sound: the copied colour maker is byte for byte the toolkit's; the validator, tests and type check pass; anchors in order; text contrast; the look is set once, at the start, in one call, and never cleared; the scene's source against the toolkit's rules character by character; all 34 printed ratios; the counts and claims on the page; no branding; keyboard and layout.

Found by my own checks on the way: with its animation taken out, no room rested lit, because a style rule beat the one lamp's own setting (caught by the browser check, and a real fault in the mod); the engine refused the test's first attempt at a backdrop; the exact house green on buttons fails the switch-knob check.

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 10.
- Method: the toolkit's theme guide read first; colours tuned against the toolkit's colour maker; the mod validated, type-checked and tested with Claude Code's own tools; the preview page built on the same files; independent review by a second model; fixes, each with a check. The mod was never loaded into a session: doing that would have changed how this session looked without being asked.
- Release steps when approved: look at it in the apps first; choose a licence; then remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
