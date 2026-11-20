# Rooms OS house theme: review

Demo 10 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try. An unlisted draft: not installed anywhere, not in the gallery or the sitemap. It is not private: the site deploys whatever is merged, so merging it puts the page, and the mod's files beside it, on the live site at their own addresses, reachable by anyone with the link.

**Nobody has seen this theme in a Claude app.** It was built and checked without one. Everything that can be checked from outside passes; how it looks is unproved. Treat the first look as part of the review.

**Quality bar it sets:** a theme that is data, with one source for its colours and its scene; checked by Claude Code's own validator, type check and test runner, and by a preview page that reads the same files and works out every contrast figure it prints a second way.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A Rooms OS house theme for Claude desktop | A Claude Code mod that sets a look for the desktop and mobile apps: colours for both halves of the day and a scene behind the conversation | `mod/` |
| House style: charcoal, white ink, one green | Night page `#111315`, ink `#f4f5f3`, accent seed `#3fe08a`. Buttons come out a deeper green, because the apps set the lightness; the page and README say so | `mod/hooks/house.js`, the table on the page |
| After the ClaudeDevs post, original | Own colours, own drawing; credit and link on the page; says it is not made by or with Anthropic; no logo, artwork or font of anyone's | `index.html` |

## Checks run (17 Nov 2026, run again after the outside review)

Verified by running. None of these is the apps.

- `claude plugin validate demos/rooms-os-theme/mod`: passes. It notes only that there is no licence file or icon, which matter for the plugin directory.
- `claude plugin test demos/rooms-os-theme/mod`: 4 of 4 pass.
  - Starting a session sets the whole look once, with both halves of the day and the scene.
  - Where no look is drawn, the reason goes to the status line.
  - The scene is drawn through the engine on the desktop and mobile surfaces, and another mod's scene is left alone.
  - The drawing is small, pure vector, slow, pinned to the corner, and has one room resting lit.
- Type check (`tsc` with the settings the toolkit gives): clean. Run again after the outside review on a copy of the mod outside the repo (TypeScript 6.0.2), with a second file that checks the theme's definition, hand-set colours included, against the colour maker's own type.
- `node demos/rooms-os-theme/tools/palette.test.mjs`: pass.
  - Nothing the apps would refuse. Night half: no notes from the colour maker. Day half: 12, each within 0.12 of its bar, all about lines and fills, none about words.
  - Strict words check (added after the outside review): with the bar held at 4.5 to 1, not lowered to the design system's own figure, every pair of words in the colour maker's own table reads in both halves; so do the seven git state colours on every surface and on their own tint, and the ink on every role's button at rest and on hover. Before the fix this check listed 19 pairs from the colour maker's table and more from its own sums, the lowest 2.48 to 1.
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
- Pictures not taken again after the outside review: the colours the specimen paints are the same before and after the fix (compared in Node), and the hand-set colours appear nowhere on the page.
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

Also not checked: the git state colours and the darker hover on danger and pro buttons as the apps paint them (set by hand after the outside review, checked only by sums); Safari and Firefox for the preview page; a real screen reader; how a session started in a terminal is opened in an app.

## Known limits

- The house green is the seed, not the button colour. See above and the README.
- The scene is small and in one corner. An earlier version drew a plan across the whole ground; the review showed it put lit rooms behind the words on some screens and showed none at all on a phone.
- The day half's 12 notes are the price of paper that is tinted and surfaces that can be told apart. All are about lines and fills. Held to the full 3 to 1 for lines and controls, borders, rings, slider and switch tracks fall short in both halves, as the design system's own do. Not changed.

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

## Outside review

ChatGPT in chat mode at Pro, driven by another Claude session at the owner's request, reviewed this pull request (137) together with pull request 136 (Orbit Census) on 17 November 2026. It read the code and the pictures and did not run the page. It scored the pair 7 out of 10, with the verdict "ship after fixes". Each finding was then checked here by running the code; what was found and done is below. Findings about pull request 136 belong to another demo and were not touched.

| Finding | What was done | Held by |
|---|---|---|
| 137: exported colours fail 4.5 to 1 for words: day-mode git state colours at 3.28 to 1 on a card and 2.48 to 1 on their own tint; hover colours too | True, and wider than stated. Its figures were reproduced exactly (git added 3.28, git closed 2.48). Held to 4.5 to 1, 19 pairs of words fell short in the colour maker's own table: all seven git colours by day, git removed and closed by night, and white words on the danger and pro buttons on hover in both halves (3.90 to 4.02). Fixed in `house.js`: git colours set by hand (darker by day; removed and closed lighter by night) and a hover shade for danger and pro a little darker than the button. Now none falls short; the day half's notes went from 25 to 12, all about lines and fills | `tools/palette.test.mjs`, two new strict checks; one also confirms the review's 3.28 with its own sum |
| 137: the toolkit's checker lowers its bar when the design system's own colours fall short | True: `mod/hooks/make-colors.js`, in `checkThemeWith`, the bar is the lower of 4.5 and the design system's own figure. The file is the toolkit's and must stay unchanged, so it was not edited. The demo's test now loads a copy in memory with the bar fixed at the full figure and requires no pair of words to fall short | `tools/palette.test.mjs` |
| 137: the palette tests mostly check the colours the specimen picks | True of the version reviewed (the words checks covered the specimen's own picks). Now also the git colours on every surface and tint, every button's ink at rest and on hover, and the colour maker's whole table at a strict bar | `tools/palette.test.mjs` |
| 137: "no notes" does not establish accessibility | True. The page now says the colour maker's silence does not prove words read, and what the demo's own checks hold instead | `index.html`; `tools/smoke.mjs` checks the new count of hand-set colours on the page |
| 137: actual app focus and rendering need a recorded check | Not done: there is no Claude app on this machine, and the mod was not loaded into any session. Still the first thing to do; see "Not verified" | Nothing; it needs a person with the apps |
| Both: CI does not run the theme's palette, smoke or mod tests | True: `.github/workflows/seo.yml` runs none of them. Not done: changing the site's workflows is outside this demo's folder and is the owner's decision. The README now says the checks are run by hand | README, Status |
| 137: "unlisted" wording; README said nothing is published, but the builder will publish the page and the mod's files after merge | True: `scripts/build-site.py` copies every demo folder except `tools` and Markdown, so `mod/` (code, colours, `.claude-plugin/plugin.json`) is served beside the page. README Status and this file's verdict now say it is an unlisted draft, reachable by anyone with the link once merged | README, Status; Verdict above |
| 137, sound: main ink about 17.03 to 1 by night and 16.26 by day; visible focus, pause and reduced-motion handling; no personal details, analytics, outside fonts or storage | Consistent with what runs here: the palette test prints 17.0 and 16.2 (cut short), and the browser check passes axe at five sizes with no outside requests | `tools/palette.test.mjs`, `tools/smoke.mjs` |
| Could not verify: Claude desktop and mobile rendering and focus; real-device performance; 200% zoom | Agreed, and still not done here: no apps, no real devices | Nothing |
| Licence (the validator's note, which the review's scores touch on) | Not done: choosing a licence is the owner's decision. Recorded under Provenance as a release step | Nothing |
| 136: close-approach wording and the 10 m/s filter | About another pull request, not this demo | Not applicable |
| 136: O3b label | About another pull request, not this demo | Not applicable |
| 136: "My location" leaves the city selector misleading | About another pull request, not this demo | Not applicable |
| 136: stale failure documentation in DESIGN.md | About another pull request, not this demo | Not applicable |
| 136: Orbit's browser checks never load data; needs a fixture | About another pull request, not this demo | Not applicable |

## Provenance

- Model: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session, high effort.
- Prompt: Kol's 17 Nov instruction to build the Fable benchmark demos in order, with the Chief of Staff's brief for item 10.
- Method: the toolkit's theme guide read first; colours tuned against the toolkit's colour maker; the mod validated, type-checked and tested with Claude Code's own tools; the preview page built on the same files; independent review by a second model; fixes, each with a check. The mod was never loaded into a session: doing that would have changed how this session looked without being asked.
- Release steps when approved: look at it in the apps first; choose a licence; then remove the `noindex` line in `index.html`, add the gallery card in `demos/index.html` and the route in `sitemap.xml`, add a Typefully draft.
