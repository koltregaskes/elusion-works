# Close Shave: a small arcade game

Walls of ink cross a square room. Each has one gap. Get through the gap, and cut it close: through with almost no room to spare is a close shave, and makes the next wall worth more. The last of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is an original game.** The idea, the rules, the name and the look were made for this page. It copies no existing game.

**It needs sight and quick hands.** There is no way to play it by screen reader, and the page says so.

**Quality bar it sets:** a game whose rules are one file with no page and no clock in it, so that a game is a seed and its moves: the same seed and moves always give the same game, every wall is proved possible by a careful player who is never hit, and the page is proved to play by those rules to the last figure.
Use it as the reference for small games and anything that moves in real time.

## How it plays

- **Move** with the arrow keys or W A S D. On a touch screen, drag anywhere in the room: you move by as much as your finger does, so your finger never has to cover you.
- **Each wall is shown at the edge before it comes in,** thin and growing clearer, with its gap already in place.
- **A wall is 10 points.** Through with under 2 units to spare is a close shave: double, and the next wall is worth one times more, up to five times. A wide berth lets the run slip by one. A hit costs one of three lives, ends the run and leaves you safe for a moment.
- **It gets harder every eight walls:** faster walls, narrower gaps, shorter warnings. It is at its hardest from level 11.
- **Pause** with P or Escape, or the button. The game also pauses by itself when you look away.
- **Slower** runs the game at six tenths of its speed, for anyone who wants it. **Sound** is off until you turn it on.
- **Same walls again** replays the walls you just had. **New walls** gives you others.
- With less movement asked for in your system settings there is no trail behind you, no shake on a hit and no drifting words. The walls still move: that is the game.
- Nothing is saved. Your best score lasts until you leave the page.

## Fairness

Every wall can be got through. Two walls that travel the same way round are never in the room together, each is shown before it enters, and its gap is never further from the last one than you can move in the time. The checks prove it: a careful player, who only ever moves to the next gap, plays 30 different sets of walls for three minutes each, up to level 17, and is never hit.

## How it is made

- `js/game.js`: the rules. The room, the walls, the levels, moving, hits, scoring, and the careful player. No page and no clock, so it runs in Node. The game moves in steps of a 120th of a second, however fast the screen draws.
- `js/app.js`: draws the room on a canvas, reads the keys and the finger, keeps time, and shows the screens around the game.
- `index.html`: the styles and the markup.
- No library, no font, picture or sound file, no outside request. The few sounds are made by the browser.

## Checks

From the site's root, with the site served on port 8786:

```bash
node demos/close-shave/tools/game.test.mjs
```

```bash
node demos/close-shave/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8786
```

```bash
node demos/close-shave/tools/shots.mjs http://127.0.0.1:8786 demos/close-shave
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- No person has played it. Whether it is fun, too hard or too easy is not known. The checks prove it is fair and that it works, not that it is good.
- The sound has never been heard.
- It cannot be played without sight, or by someone who cannot move a pointer or press keys quickly. Slower helps some; it is not a fix.
- No gamepad.
- On a phone held on its side the room is small.
- Checked only in headless Chromium. Not yet tried in Safari or Firefox or on a real phone.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
