# Snapshot Circuit

A racing game made from one photograph. Demo 4 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Quality bar it sets:** a game whose level comes from the player's own picture, with rules that can be checked without a screen. The page reads the photograph, the circuit is built from what it found, and the same race can be replayed step for step in a test.
Use it as the reference for small browser games and for anything that turns a picture into something to play with.

## What it does

- Looks at a photograph and finds the things in it that stand out from their surroundings (by colour, and by contrast for dark things).
- Lays the photograph flat as the ground and draws a circuit round the group of things it found. Every photograph gives a different circuit.
- The things stand up from where they lie in the picture, cut out like stickers, beside the road. They are solid: hit one square on and you stop; clip one and you slide round it. A thing with no room beside the road is left flat, and the start card says so.
- Small things become boosts on the road. If the picture has none, boosts are placed in the picture's own colours.
- Three laps against two computer drivers. Laps only count if you take the checkpoints in order, so short cuts and reversing earn nothing.
- Two views (behind the kart, and from above), a map made of the photograph itself, pause, and a button that puts you back on the road.
- **Use your own photo** builds a new circuit from any picture. The picture is read in the page and is never uploaded. Very wide or tall pictures are cut to their middle.
- Keyboard on a computer; on a phone the kart drives itself forward and you steer and brake with on-screen buttons.
- Small synthesised sounds (engine, bump, boost, lap), with a mute button.

## How it is put together

| File | Job |
|---|---|
| `js/photo.js` | Reads the picture: groups its colours, treats what hugs the border as background, and returns the objects with their place, size, colour and outline. No drawing, no page. |
| `js/track.js` | Turns those objects into a closed circuit, hazards, checkpoints and boosts. |
| `js/game.js` | The race: a fixed-step simulation with no clock of its own, so the same inputs always give the same race. |
| `js/app.js` | The page: 3D view (Three.js r160, shared copy in `demos/_shared`), controls, sound, screens. |

## Checks

```bash
node demos/snapshot-circuit/tools/sim.test.mjs
```

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium node demos/snapshot-circuit/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8771
```

The first runs the circuit maker and whole races in Node. The second drives the page in a browser (serve the repo root first). `tools/shots.mjs` re-takes the pictures in this folder.

## The sample photograph

`img/caps.jpg` is image 3 ("caps") of the Kodak Lossless True Color Image Suite, scaled to 768 by 512. The suite's archive page (r0k.us/graphics/kodak) says the images were released by the Eastman Kodak Company for unrestricted usage. This copy came from a public GitHub mirror of the suite, whose README repeats that statement. **Caveat:** that statement is the only licence evidence checked. If Kol wants no doubt at all, swap in one of his own photographs: replace the file and the credit line in `js/app.js`.

## Credit

The idea follows a post by Dan Shipper about a photograph turned into a racing game (x.com/danshipper/status/2119869228207546638). Nothing was copied from it: the code, the circuit maker, the karts and the look were written for this page.

## Status

A draft, and unlisted: the page carries `noindex`, is not in the demo gallery and is not in the sitemap. The site deploys whatever is merged, so merging this would put the page on the live site at its own address, unlisted but reachable by anyone with the link. See `REVIEW.md` for what was checked and what was not, and for the outside review.
