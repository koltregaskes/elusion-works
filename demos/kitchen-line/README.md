# Kitchen Line

A small 3D pickleball game for the browser. Singles on a full-size court, with the real rules: the two-bounce rule, the kitchen, side-out scoring, win by two. Keyboard, mouse or touch, against a rival at three levels. Demo 11 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by chongdashu](https://x.com/chongdashu/status/2120154573356793883) about a pickleball game in Three.js. This is an original game: its own court, players, rules code and sounds, all made in the page. No model, picture or sound file is loaded.

**Quality bar it sets:** a game whose rules are a module that plays whole matches without a browser, so every rule is staged and checked one at a time, hundreds of matches are played to the end as a check, and the controls are proved playable by a plain hand-written player before anybody picks it up.
Use it as the reference for browser games with real rules.

## Playing

- **Move:** arrow keys or W A S D, or point with the mouse, or drag a finger. Your player runs to where you point.
- **Hit:** Space or a click to drive, K to dink it softly over the net, L to lob. Three buttons do the same. Swing when the ball is within reach; a drive at a ball above the shoulder is a smash.
- **Aim:** the way you are moving, or where the mouse or your finger is, left or right.
- **A ring on the court** shows where the ball will land. It turns coral when the ball is going out, which is your cue to leave it.
- **Pause:** P or Esc, or the button. The game also pauses when you look away.
- **Watch a game first** plays one for you.

## The rules it keeps

- The court is 20 by 44 feet with a 7 foot kitchen each side of a net 34 inches high at the middle and 36 at the posts.
- The serve is from behind the baseline, from your right-hand court when your score is even and your left when it is odd, to the court on the diagonal. It must land beyond the kitchen line.
- The serve must bounce before it is returned, and the return must bounce before the server plays it. After that, volleys are allowed.
- No volley while standing in the kitchen or on its line.
- A ball on a line is in. A ball that bounces twice, goes into the net, lands out, or does not cross the net loses the rally for whoever was at fault.
- Only the server scores. Lose the rally on your serve and the serve changes hands. First to 5, 7 or 11, and win by two.

Left out, on purpose: doubles, the let, foot faults on the serve, and stepping into the kitchen after a volley carries you forward.

## How it is made

- `js/rules.js`: the court, the ball, the rules, the scoring and both players' brains. No drawing and no page, so whole matches run in Node. Matches play from a seed, so any match can be played again exactly.
- `js/app.js`: the page: the court and players drawn with three flat tones and a dark outline, the controls, the scoreboard, the lettering that pops where things happen, and the sounds, which are made from a tone and a puff of hiss.
- Three.js r160 from this site's shared copy. No other library, no outside request, nothing stored.
- The ball is drawn at twice its real size so that it can be seen from the back of the court. The game uses the real one.

## The rival

Three levels, different in how fast they run, how quickly they read a shot, how far their shots stray and how well they judge a ball going out. A shot strays more when the ball is fast, when it comes back almost at once, and with each volley in a row, so quick exchanges at the net end.

Measured, not felt: a plain hand-written player that only runs to the ball, lets it bounce and drives it beat the Easy rival 24 times in 24, the Club rival 10 times in 24 and the Pro rival once in 24.

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

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. `REVIEW.md` lists what each one proves and what nobody has checked.

## Honest limits

- **Nobody has played it by hand.** Whether it is fun, whether the timing feels fair, and whether the three levels feel like three levels are all untested by a person.
- Checked only in headless Chromium with software graphics. Not yet seen on a real graphics card or a real phone, in Safari or Firefox, and the sounds have not been heard.
- A game played by sight and timing cannot be played with a screen reader. Points, faults and the score are announced, and every control is a real button or key, but that is not the same as being playable.
- The players are simple figures and the shots are aimed at a place on the court, not swung with a timed stroke.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
