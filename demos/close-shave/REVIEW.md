# Close Shave: review

Gap demo 7 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a small 2D arcade game.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to play. Not published, not in the gallery or the sitemap.

**Nobody has played it.** The checks show that every wall can be got through and that the page does what it says. They cannot say whether it is fun. It needs sight and quick hands, and the page says so.

**Quality bar it sets:** a game whose rules are one file with no page and no clock in it, so that a game is a seed and its moves: the same seed and moves always give the same game, every wall is shown to be possible from wherever you stand, and the page is proved to play by those rules to the last figure.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A small 2D arcade game | Close Shave: walls cross a room, each with one gap; the closer you cut it, the more it is worth | `js/game.js`, `js/app.js` |
| Original work | The idea, rules, name and look were made for this page. Walls with gaps are a common kind of game; no one game's rules, levels or look are copied | `README.md` |
| Kol's taste: title card, charcoal, white, one green; comic-book, not anime | White headline on charcoal, one green. Walls throw off dots of ink, a hit is a comic burst, call-outs are caption boxes | `screenshot.jpg` |
| Own folder, own review, nothing live | `demos/close-shave/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/close-shave/tools/game.test.mjs`: pass.
  - The same seed and moves give the same game. Doing nothing loses in three hits.
  - Five players, four of whom wait at the edges and corners between walls, get through 20,267 walls on 30 sets, up to level 18, without a hit. No wall shows its gap further off than you can go in the warning.
  - Running ahead of a wall scores nothing, and the wall can still hit. You are hit as a circle. Scoring, close shaves, hits, the safe moment and creeping are right on walls set by hand.
- `node demos/close-shave/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: the page says the game needs them.
  - Keys, pause by P, Escape, the button and looking away. Nothing moves while paused.
  - Three games played by rule end exactly where the rules alone end, and the figures above the room are the game's.
  - You are drawn green where the game says, the wall white and the gap not. Each close shave is called out with the room left.
  - Slower runs at six tenths and does not count towards the best. Space in mid game presses nothing. Shift creeps. A drag stops at the wall and turns back at once.
  - Less movement: no trail. Phones 390x800, 320x568 and 740x360 by touch, 1920x1080 and text at twice the size: the room is square and whole, Pause is in sight with it, and the covers are whole with nothing to scroll inside the room.
  - axe WCAG 2.2 A and AA ready, playing, paused and over. No console errors, no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **Whether it is any good to play.** No person has played it, by keys or by touch.
2. **The sound.** Never heard.
3. **The look**, judged by a person. The reviewer called the first version white bars on a grid; it was changed, and nobody has judged the result.
4. A real phone, Safari and Firefox, a screen reader, a keyboard that is not laid out QWERTY.
5. Whether another game is already called Close Shave.

## Known limits

- One kind of wall, no ending, no saved best.
- A machine with perfect control can hold the run at five times for ever. A person cannot easily.
- It cannot be played without sight or quick hands.
- The checks play by rule. A check that a key moves you in real time is the only one that leans on the clock.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It tested the rules with its own players over hundreds of sets of walls, drove the page at five sizes, and read every word. 15 findings: 10 should-fix, 5 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | A wall was counted as passed the moment you stopped touching it, even if you had only touched its front and run on ahead. It then could not hit you. On the early levels every wall could be scored that way | A wall counts only once its back has gone by you. Running ahead scores nothing and the wall still hits | rules test, on a wall set by hand |
| 2 | "Every wall can be got through" was only true near the last gap. A player waiting at an edge was sent walls nobody could pass | A wall's gap is now set by where you are standing when it is shown, never further off than you can go in the warning | rules test: four awkward-place players, and every wall of five sets |
| 3 | With perfect control every wall could be a close shave, and by keys the window was a fortieth of a second | Shift creeps at four tenths of your speed; the gap's edges are marked; each shave shows the room left. A machine can still hold five times: a known limit | rules and browser checks for creeping |
| 4 | A drag that went past the room's wall had to come all the way back before you moved | The drag stops at the wall and starts afresh from there. One finger at a time | browser check |
| 5 | At large text, and with a four-figure score on a phone on its side, the covers were cut off or scrolled inside the room | The room grows to hold a cover's words | browser check at three sizes with large text, and with a large score |
| 6 | On a phone the Pause button was below the room, out of sight while playing | The buttons are above the room, and the two are brought into sight together | browser check at every size |
| 7 | Access: the warning that it needs sight was only in the footer; Pause was announced as "Resume, pressed"; Space in mid game pressed whatever button held the focus | The warning is on the Ready cover. The button is named for what it does. Space in mid game presses nothing, and a button pressed in mid game hands the focus back | browser check |
| 8 | Faint drawing: the warning strip, a wall that had hit you, the safe ring | Stronger and wider | by looking |
| 9 | Words that claimed too much or said the wrong thing: "walls of ink" on plain bars, "a hit ends the run", "the checks prove it is fair" | Walls now throw off ink; the scoring words are rewritten; the fairness claim says what the checks hold it to | by reading |
| 10 | Checks that leaned on the wall clock, a Tab check at one size only, a fairness check on one kind of player | Slower and creeping are measured by the page's own timekeeping; Tab is checked at four sizes; fairness has five players | the checks themselves |
| 11 | You were hit as a square, a little outside the drawn dot; a wall's shadow fell across other walls | You are hit as a circle. Shadows are drawn first | rules test; by looking |
| 12 | W A S D by letter fails on other keyboard layouts; the room was soft on some screens; slower games counted towards the best | Keys are read by position. The room is drawn at the screen's own sharpness. Slower games do not count | browser check for the best |
| 13 | A slow first minute, no variety, little of the comic about it | Walls start faster and come sooner. A hit is a comic burst. One kind of wall and no ending remain: known limits | by looking; not judged by a person |
| 14 | The name is also a Wallace and Gromit film | Kept: it is an everyday phrase. Said in the README | |
| 15 | Awkward words: "one times more", "lets the run slip by one", "Walls no. 5" | Rewritten; the number is gone | by reading |

## Provenance

- No library, no font, picture or sound file. The sounds are made by the browser.
- An original game. Nothing is taken from any other.
