# Elusion One

A product turntable for a camera that does not exist. Turn it by hand, watch a 36-second film of it, or fade the outside away and look at the sensor, shutter, battery and glass inside. Demo 8 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by xikhar](https://x.com/xikhar/status/2119966147328299284) showing a product-grade 3D model with a camera path and an interior view. This is an original build: the camera is invented, no real camera was copied, and no model file is loaded. Every surface is a box, a cylinder, a sphere or a ring made in code, with drawn textures for the grip, the knurling, the rear screen and the reflections in the front glass.

**Quality bar it sets:** a product model whose film is a script that can be checked frame by frame without a browser (never inside the object, never jolting, ending where it began), and whose labels are tested against the model's real geometry, so a label can never point at empty space.
Use it as the reference for 3D product pages and scripted camera moves.

## What you can do

- **Turntable.** The camera turns slowly on its table. Drag to turn it yourself, scroll or pinch to move closer, or use the arrow keys, plus and minus, and Home. The table holds still while you hold it.
- **Play the film.** Seven shots, cut one to the next: the reveal, across the top plate, into the glass, round the grip, the back, inside, and the name. The page gets out of the way while it plays. Press the button again, press Escape, or take hold of the camera to stop it.
- **Look inside.** The outside fades to a faint outline and eight parts are labelled where they sit: sensor, shutter, stabiliser, main board, battery, card slot, viewfinder, lens elements.
- **Choose a part.** Eleven parts in a list (eight inside, three outside). Choosing one squares the table, moves to a view of that part and says what it is.
- **Silver.** Switches the top plate between black and silver.

With "reduce motion" set, the table does not turn, views cut instead of gliding, and the film is shown as seven stills, one per press.

## How it is made

- `js/film.js`: the camera's sizes, the eleven parts, the seven shots and the arithmetic of the camera path. No drawing and no page, so it runs in Node.
- `js/camera.js`: the model. Each outside piece has a faint twin and an outline, which is what is left when the outside fades.
- `js/app.js`: the page: light, turntable, modes, labels, controls.
- Three.js r160 from this site's shared copy. No other library, no outside request, nothing stored.
- Sizes are in centimetres: the body is 13.4 wide, 8.4 high, 4.2 deep, and the lens stands 9 out from the middle.

## Checks

From the site's root, with the site served on port 8775:

```bash
node demos/camera-turntable/tools/film.test.mjs
```

```bash
node demos/camera-turntable/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8775
```

```bash
node demos/camera-turntable/tools/shots.mjs http://127.0.0.1:8775 demos/camera-turntable
```

The first checks the film's script frame by frame. The second drives the page in a browser. The third writes the pictures in this folder. `REVIEW.md` lists what each one proves and what nobody has checked.

## Honest limits

- It is a model of an invented camera, drawn to look right, not an engineering drawing. The insides are simplified: the parts are the right kind of thing in roughly the right place, not a real camera's layout.
- "Seven pieces of glass in five groups" describes the invented lens; the model draws seven pieces.
- Checked only in headless Chromium with software graphics. Not yet seen on a real graphics card, a real phone, Safari or Firefox, and nobody has yet turned it by hand.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
