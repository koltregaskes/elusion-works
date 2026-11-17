# Kitchen Line

A small 3D pickleball game for the browser. Singles on a full-size court, with the real rules: the two-bounce rule, the kitchen, side-out scoring, win by two. Keyboard, mouse or touch, against a rival at three levels. Demo 11 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by chongdashu](https://x.com/chongdashu/status/2120154573356793883) about a pickleball game in Three.js. This is an original game: its own court, players, rules code and sounds, all made in the page. No model, picture or sound file is loaded.

**Quality bar it sets:** a game whose rules are a module that plays whole matches without a browser, so every rule is staged and checked one at a time, hundreds of matches are played to the end as a check, and the controls are proved playable by a plain hand-written player before anybody picks it up.
Use it as the reference for browser games with real rules.

## Playing

- **Move:** arrow keys or W A S D, or point with the mouse or a finger on your side of the net. Your player runs to where you point.
- **Hit:** Space or a click to drive, K to dink it softly over the net, L to lob. Three buttons do the same. A drive at a ball above the shoulder is a smash.
- **Timing:** swing as the ball arrives. A swing lasts a quarter of a second and takes the ball at its best moment in that time, so pressing a little early is fine: the swing waits for the bounce if the ball is about to bounce. Pressing far too early misses. It never costs you the point by itself.
- **Aim:** the way you are moving, left or right. With the mouse or a finger, point across the net: that aims the shot and leaves you where you stand.
- **A ring on the court** shows where the ball will land. It turns coral when the ball is going out, which is your cue to leave it.
- **Pause:** P or Esc, or the button. The game also pauses when you look away.
- **Watch a game first** plays one for you.

## The rules it keeps

- The court is 20 by 44 feet with a 7 foot kitchen each side of a net 34 inches high at the middle and 36 at the posts.
- The serve is from behind the baseline, from your right-hand court when your score is even and your left when it is odd, to the court on the diagonal. It must land beyond the kitchen line.
- The serve must bounce before it is returned, and the return must bounce before the server plays it. After that, volleys are allowed.
- No volley while standing in the kitchen or on its line.
- A ball on a line is in. A ball that bounces twice, goes into the net, lands out, or does not cross the net loses the rally for whoever was at fault.
- A ball that clips the top of the net and goes over is in play, a serve included: there is no let.
- Only the server scores. Lose the rally on your serve and the serve changes hands. First to 5, 7 or 11, and win by two.

Left out, on purpose: doubles, foot faults on the serve, and the rule that a volley is a fault if it then carries you forward into the kitchen.

## How it is made

- `js/rules.js`: the court, the ball, the rules, the scoring and both players' brains. No drawing and no page, so whole matches run in Node. Matches play from a seed, so any match can be played again exactly.
- `js/app.js`: the page: the court and players drawn with three flat tones and a dark outline, the controls, the scoreboard, the lettering that pops where things happen, and the sounds, which are made from a tone and a puff of hiss.
- Three.js r160 from this site's shared copy. No other library, no outside request, nothing stored.
- The ball is drawn at twice its real size so that it can be seen from the back of the court. The game uses the real one.

## The rival, and how rallies end

Three levels, different in how fast they run, how quickly they read a shot, how far their shots stray, how near the lines they dare to aim and how well they judge a ball going out.

- **Nobody is perfect.** Every shot strays a little however cleanly it is struck, yours included: about 4 in 100 clean drives from the baseline go into the net or out. A soft shot strays less than a hard one.
- **Pressure tells.** A shot strays more when the ball is fast, when it comes back almost at once, and with each volley in a row, so quick exchanges at the net end.
- **Long rallies tire the arm.** Past twenty shots every shot strays a little more than the last. The longest rally in 236 checked matches was 53 shots.
- **Players take a moment to get going** and as long to stop, so a ball placed away from them can be a winner.

Measured, not felt. Three plain hand-written players, each a few lines of code working the same controls you have, played 12 matches each against every level:

| Player | Easy | Club | Pro |
|---|---|---|---|
| Runs to the ball, lets it bounce, drives it | won 12 | won 12 | won 4 |
| The same, but swings only at a ball in the middle of the paddle | won 12 | won 9 | won 0 |
| The same, but dinks everything | won 12 | won 9 | won 0 |

These players never misjudge where the ball will land. A person will, so expect to do worse than they do.

## Checks

From the site's root, with the site served on port 8778:

```bash
node demos/kitchen-line/tools/rules.test.mjs
```

```bash
node demos/kitchen-line/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8778
```

```bash
node demos/kitchen-line/tools/shots.mjs http://127.0.0.1:8778 demos/kitchen-line
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- **Nobody has played it by hand.** Whether it is fun, whether the timing feels fair, and whether the three levels feel like three levels are all untested by a person.
- Checked only in headless Chromium with software graphics. Not yet seen on a real graphics card or a real phone, in Safari or Firefox, and the sounds have not been heard.
- A game played by sight and timing cannot be played with a screen reader. Points, faults and the score are announced, and every control is a real button or key, but that is not the same as being playable.
- The players are simple figures. They stride, turn to the ball, reach for it and smash overhead, but they have no knees or elbows, and a ball struck at full stretch still leaves from a little way off the paddle.
- Shots are aimed at a place on the court. How hard you hit is the shot you choose, not how long you hold the key.
- On a slow machine the game keeps its speed and the picture stutters. That has been read in the code and seen at about 8 pictures a second in the checks, not measured on a real slow device.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
