# Kitchen Line: review

Demo 11 of the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876).
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to play. A draft, unlisted: not in the gallery or the sitemap, and not on the live site yet. Merging it would put it on the live site at its own address, reachable by anyone with the link, because the site deploys whatever is merged.

**Nobody has played it by hand.** The rules, the scoring and the fairness of the timing are checked by staging each case and by playing hundreds of whole matches. Whether it is fun, and whether Easy, Club and Pro feel like three levels to a person, is unproved. Treat the first game as part of the review.

**Quality bar it sets:** a game whose rules are a module that plays whole matches without a browser, so every rule is staged and checked one at a time, hundreds of matches are played to the end as a check, and the controls are proved playable by plain hand-written players before anybody picks it up.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A browser 3D sports mini-game | Pickleball singles, simplified rules, on a full-size court in Three.js: you against a rival at three levels, or watch the game play itself | `index.html`, `js/app.js` |
| After the chongdashu post, original | Own court, players, rules code, lettering and sounds, all made in the page. No model, picture or sound file is loaded. Credit and link on the page | `index.html`, `README.md` |
| Kol's taste: comic-book, charcoal, white, one green | Three flat tones and a dark outline; charcoal ground; white lettering that pops where things happen; one green, on your cap, your paddle and the wall's rule | `screenshot.jpg` |
| Own folder, own review, nothing live | `demos/kitchen-line/`, this file, `noindex`, no gallery card, no sitemap entry. Not live until merged; once merged it is reachable at its address though unlisted | `index.html` |

## Checks run (17 Nov 2026, run again after the outside review)

Verified by running. All passed on the code as committed. Matches and figures from the rules test are unchanged by the movement fix, number for number.

- `node demos/kitchen-line/tools/rules.test.mjs`: pass.
  - The court is to regulation. 48 shots land where they are aimed and clear the net by their margin.
  - Every rule staged and called right: out, lines in, two bounces, net, short, kitchen, the two-bounce rule, the serve, win by two.
  - Running is the same speed every way: one key, two keys on the diagonal, a finger on the diagonal and out-of-range input all cover 2.070 m in half a second from standing and reach 5.2 m/s (worked out by hand from the rules' own speed and easing).
  - 128 whole matches to 7 between the game's own players: all finished, 2.5 minutes each on average, 2,099 rallies of 5.1 shots on average, longest 29. They ended: ball not reached 56%, out 19%, net 18%, short 5%, serve missed 2%.
  - Points only ever to the server. No player broke a rule it knows. 1.7% of serves missed. Shots: drive 51%, dink 38%, lob 7%, smash 3%.
  - Fair play: 217 presses, from 0.4 s before the bounce of a serve to 0.1 s after it. None was called a volley; 130 struck the ball after its bounce. A swing pressed at arm's length meets the ball within 0.8 m.
  - A ball that clips the tape plays on, a serve included. 4.2% of clean baseline drives go wrong.
  - Three plain players at the controls, 12 matches each against Easy, Club and Pro: won 12, 12, 4; 12, 9, 0; 12, 9, 0. Longest rally 53. The ring on the court was right about all 16,600 balls it was checked on.
- `node demos/kitchen-line/tools/smoke.mjs`: pass, in headless Chromium with software graphics.
  - Starts on the card with a game behind it. The card says simplified singles rules and How to play lists what is left out. Space, K, L, a click and all three buttons serve. Arrows, letters and the pointer move you.
  - Running speed through the page: one arrow key, two arrow keys held on the diagonal and a finger pointing on the diagonal all run at 5.19 m/s after 0.75 s.
  - Pointing across the net aims without moving you. Space still serves after a click on Sound.
  - A smash starts above and behind the head and comes down in front; a drive ends in front at chest height; a dink stays low; the legs stride.
  - A whole game played by a script that sends key events (W A S D and Space) to the page, so the page's own key handlers drive it: scoreboard, serving dot, call and spoken line right after every rally; the result card right. The events come from a script, not a person typing.
  - Pause by button, P, Escape and looking away. Watching, the players are White and Coral everywhere. The game behind the start card starts again when it ends.
  - Phones 390x800, 320x568 and 740x360, a 320 window and 1920x1080: the whole court on screen, thumb-sized buttons that cover nothing, the call clear of your rival.
  - Reduced motion, no WebGL, axe WCAG 2.2 A and AA at six sizes, no console errors, no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; `python3 scripts/build-site.py` passes.
- `tools/shots.mjs` run again; the start card picture (`thumbnail.png`) shows the new wording.

## Not verified

1. **Feel.** Nobody has held the controls. Is the quarter-second swing comfortable? Does a clean drive going out 4 times in 100 feel fair or cheated?
2. **The levels, to a person.** The three plain players never misjudge where the ball lands. A person will.
3. **A real graphics card and a real phone.** Software graphics ran at about 8 pictures a second here, so smoothness is unseen.
4. **Sound.** Made, never heard.
5. Safari and Firefox. A real screen reader.
6. A slow device. The game is written to keep its speed and let the picture stutter; that was read in the code, not measured.

## Known limits

- The players have no knees or elbows. A ball struck at full stretch still leaves from a little way off the paddle.
- Shots are aimed at a place; power is the shot you choose, not how long you hold the key.
- A game of sight and timing cannot be played with a screen reader. Points, faults and the score are announced.
- Tabbing past the last button leaves the page, and leaving the page pauses the game.
- Left out on purpose: doubles, foot faults on the serve, and the fault for being carried into the kitchen after a volley.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It ran its own scripted players and staged its own cases. 14 findings; all acted on.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. Pressing 0.04 to 0.26 s early at a serve lost the point as a volley | A swing waits for a ball about to bounce, takes the ball at its best moment, and a ball almost on the ground is a miss, never a fault | rules test: 217 presses, none called a volley |
| 2 | Blocker. A player who swung only at centred balls never erred: 17,934 drives without a miss, rallies of 2,772 shots | Every shot strays a little however clean. Long rallies tire the arm | rules test: 4.2% of clean drives go wrong; longest rally 53 |
| 3 | The rival ran away from low balls, so a dinker beat Pro more often than Club | The rival plans for any ball it can reach and runs at where it comes down | rules test: each plain style wins most against Easy and least against Pro |
| 4 | Any touch of the net was a fault | A ball that clips the tape goes over in play, a serve included | rules test, four staged balls |
| 5 | The mouse dragged your player wherever you pointed, into the kitchen | Pointing across the net aims and leaves you standing | browser check |
| 6 | After a click on Sound, Space pressed Sound again | The keys go back to the court | browser check |
| 7 | Watch mode said "you" and "your rival" | White and Coral in the scoreboard, the call, the spoken line and the pause card | browser check |
| 8 | The call covered your rival on small and sideways phones | Moved to the corner on short windows and over the net on upright phones | browser check at five sizes |
| 9 | Serves never missed; every volley was a drive | Serves stray like any shot (1.7% miss). A low ball at the kitchen line is dinked more often than driven (38% of shots are dinks) | rules test |
| 10 | The look: legs never moved, no shoulders, a smash was a push at the hip, a floating visor, pops piling up, a small court on very wide screens | Legs stride and shuffle; shoulders and a neck; the body turns to the ball and reaches for it; a smash is overhead; a round brim; pops stack; a lower, closer camera on wide windows; a back wall with the name | browser check on the swings, the stride and the pops; `screenshot.jpg` |
| 11 | The game behind the start card ended and froze | Another begins | browser check, eight minutes on |
| 12 | README named a REVIEW.md that did not exist | This file | |
| 13 | The browser check failed 2 runs in 3 on a tap; the rival broke the kitchen rule on other seeds; the README's figures held for one weak player only | The check reads the match, not its own steps. The game's players cannot volley unlawfully. Figures are now for three styles | browser check; rules test over 236 matches |
| 14 | Smaller: a receiver could wind up a swing during the serve; the ring disagreed with the game about the net in 25 of 204 cases; slow motion on a slow machine; lettering stayed put after a resize | Only the server swings at a serve. Ring, game and rival share one net rule (16,600 of 16,600 agree). Several steps a picture on a slow machine. Lettering clears on resize | rules test; browser check; the slow-machine case is not measured |

Not changed, by choice: the first Tab on the start card lands on the court picture, and Tab past the last button leaves the page.

## Outside review

ChatGPT in chat mode at Pro, driven by another Claude session at the owner's request, reviewed this demo together with Shot Framer on 17 November 2026. It read the code and the pictures and did not run the page. Score 6/10, verdict HOLD for both. Only the findings about Kitchen Line, and those that apply to both demos, are dealt with here. Each was checked before anything was changed.

| Finding | What was done | Held by |
|---|---|---|
| Keyboard players run diagonally about 41% faster than straight or by touch (2.93 m against 2.07 m in half a second) | True. Reproduced exactly: 2.928 m on two keys, 2.070 m on one key or a finger. Two keys asked for full speed across and full speed along at once. Fixed in `js/rules.js`: the direction you ask for is cut back to length 1 (`stick`) before it becomes speed, so no caller can get it wrong. Now 2.070 m every way, top speed 5.2 m/s. The game's own players and the scripted test players already asked for directions of length 1, so every whole-match figure is unchanged, number for number (128 matches, the level table, 24 of 24 for the plain player) | rules test: six ways of moving, expected values worked out by hand; browser check: one arrow key, two arrow keys and a finger on the diagonal all reach 5.2 m/s through the page |
| The page claims the "real rules" but leaves some out, said only in the README | True. The start card and the page description now say simplified singles rules, and How to play lists what is left out: doubles, foot faults on the serve, and the fault for being carried into the kitchen by your own volley. README wording changed to match | browser check reads the card and the list |
| The whole-match browser check injects control values, so it shows less than its "ok" line says | True. It handed movement straight to the rules, bypassing the page's keys. It now sends key events (W A S D and Space) to the page each step, so the page's own key handlers drive the whole game, and its ok line says it is a script sending key events, not a person typing. A separate check holds arrow keys down through Playwright, and sends a touch pointer event, on the diagonal (above) | browser check |
| Green CI covers less than the pull request suggests: the demo's own suites do not run in CI | True, and not changed: wiring them into CI means editing the site's shared workflow, which is outside this folder. The checks are run by hand and listed under Checks run above | not done: needs the owner |
| Unlisted will still mean publicly reachable once deployed | True. README Status and the verdict above now say it is a draft, not yet live, and that merging would put it on the live site at its own address, unlisted but reachable by anyone with the link | README, this file |
| No real-device play, measured smoothness or heard sound | True, and not done: no real phone, graphics card or speakers here, and nobody has played it. Still listed under Not verified | not done |
| No asset-licensing blocker | Agreed. Nothing loaded but the site's shared Three.js | |

Found while doing this, not in the outside review: on this machine, under heavy load from other work (load average near 30 on 4 processors), two existing browser checks failed on timing. Neither was a fault in the game. The lettering check failed on the committed version of the code and checks too, not only on the changed one. The lettering check waited a fixed 0.15 s for the page to hear of a new window size; the event came as much as 2.5 s late, and the lettering fades by itself after 0.95 s. It now holds off the fading for the check and reads the count the moment the page hears of the new size, so only the resize handler can clear it (shown to fail with that handler removed). The phone check of a finger moving you took 100 steps when the run needs about 70, and the page's own clock adds steps on a loaded machine, so the rally sometimes ended and you were walked back to serve; it now takes 75 steps and first checks the rally is still on. Touch movement is untouched by the speed fix (a finger already asked for a direction of length 1), and the same steps run on their own passed six times in six, three on the committed code and three on the changed code.

## Provenance

- Three.js r160, from this site's shared copy. No other library.
- No model, texture, picture, font or sound file. Everything is made in the page.
- After a post by chongdashu on X, credited and linked on the page. Not made by or with them.
