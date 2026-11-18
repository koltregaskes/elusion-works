# Close Shave: a small arcade game

Walls of ink cross a square room. Each has one gap. Get through the gap, and cut it close: through with almost no room to spare is a close shave, and makes the next wall worth more. The last of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is an original game.** The idea, the rules, the name and the look were made for this page. It copies no existing game.

**It needs sight and quick hands.** There is no way to play it by screen reader, and the page says so.

**Quality bar it sets:** a game whose rules are one file with no page and no clock in it, so that a game is a seed and its moves: the same seed and moves always give the same game, every wall is proved possible by a careful player who is never hit, and the page is proved to play by those rules to the last figure.
Use it as the reference for small games and anything that moves in real time.

## How it plays

- **Move** with the arrow keys or W A S D. Hold Shift to creep, for cutting it fine. On a touch screen, drag anywhere in the room: you move by as much as your finger does, so your finger never has to cover you.
- **Each wall is shown at the edge before it comes in,** with its gap already in place. The two edges of the gap are marked green.
- **A wall is 10 points, times your run.** Through with under 2 units to spare is a close shave: double points, and your run goes up by one, to five at most. The game shows how much room you left. A wide berth drops your run by one. A hit costs one of three lives and puts your run back to one.
- **A wall counts only once its back has gone by you.** Touching its front and running on ahead scores nothing.
- **It gets harder every eight walls:** faster walls, narrower gaps, shorter warnings. It is at its hardest from level 11.
- **Pause** with P or Escape, or the button above the room. The game also pauses by itself when you look away.
- **Slower** runs the game at six tenths of its speed, for anyone who wants it; a game slowed for any part of it is marked as such at the end and does not count towards your best, whatever the button says when it ends. **Sound** is off until you turn it on.
- **Try again** starts from the same seed, and **New walls** from another. The same seed is not the same walls: each gap is placed within reach of where you are standing, and the walls come faster as you pass more of them, so a game only repeats if you move exactly as before.
- With less movement asked for in your system settings there is no trail behind you, no shake on a hit and no drifting words. The walls still move: that is the game.
- Nothing is saved. Your best score lasts until you leave the page.

## Fairness

Every wall can be got through from wherever you are standing when it is first shown. Two walls that travel the same way round are never in the room together, so you are always free to move along a wall's gap line; and a wall's gap is never further from where you are than you can go in the warning alone. The checks hold it to that: five players, four of whom go and wait at the edges and in the corners between walls, play 30 sets of walls for three minutes each, up to level 18, and are never hit.

What that does not say: that a person will find it fair. At the hardest level you have six tenths of a second of warning. Nobody has played it.

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

- No person has played it. Whether it is fun, too hard or too easy is not known. The checks show that every wall can be got through and that the page works, not that it is good.
- With perfect control a close shave can be had on every wall, so a machine can hold the run at five. For a person the window is small: that is what Shift is for.
- There is one kind of wall and no ending. It is a small game.
- "A Close Shave" is also the name of a 1995 Wallace and Gromit film. The phrase is an everyday one, and nothing else is shared.
- The sound has never been heard.
- It cannot be played without sight, or by someone who cannot move a pointer or press keys quickly. Slower helps some; it is not a fix.
- No gamepad.
- On a phone held on its side the room is small.
- Checked only in headless Chromium. Not yet tried in Safari or Firefox or on a real phone.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published while this stays a draft. Merging it would put the page on the live site at its own address, unlisted but reachable by anyone with the link, because the site deploys whatever is merged.
