# Shot Framer

Look round a 360 picture, frame it the way a camera would, save a list of shots, and export each one as a picture. Six frame shapes from cinema to tall, a lens you can change, and a shot list in plain words. Demo 12 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by Runway](https://x.com/runwayml/status/2119874555581694370) about framing shots inside a 360 picture. An original tool, not made by or with Runway.

**Quality bar it sets:** a picture tool whose every pixel comes from one piece of arithmetic that runs without a browser, so the frame on screen and the file that comes down can both be compared, pixel for pixel, with the same frame drawn again by the checks.
Use it as the reference for image tools and anything that exports files.

## What it does

- **Look round.** Drag the picture, or use the arrow keys. What you take hold of stays under your finger.
- **Change the lens.** Scroll, pinch, use plus and minus, or move the slider. The lens is given in millimetres: what the same view would need on a full-frame camera.
- **Choose a shape.** 16:9, 2.39:1, 4:3, 1:1, 4:5 or 9:16. The frame on screen is the shape of the picture you will get.
- **Save shots.** Each is listed with a small picture and a line a director could read out: "Shot 1: facing east (90°), 8° up, 27 mm lens, 16:9". The list can be copied as text.
- **Export.** Any shot, or the frame in hand, as a PNG with its longer side 1920 or 3840 pixels. The picture is drawn again at full size from the whole 360 picture, not copied from the screen.
- **Use your own 360 picture.** Choose a file or drop one on the page. It is opened on your own device and is not uploaded. A picture that is not twice as wide as it is tall is used with a warning.
- **The sample.** A sculpture park at night: a slab to the north, an arch to the east, three balls to the south, a flight of blocks to the west, a moon in the north-east. It is worked out by the page, a direction at a time, at 4096 by 2048; no picture file is loaded. A small version shows at once and the full one replaces it a few seconds later.

## How it is made

- `js/pano.js`: the arithmetic. Which way each point of a frame looks, where that falls in a 360 picture, the lens in millimetres, export sizes, and the drawing of a frame pixel by pixel. Also the sample picture. No page and no drawing surface, so it all runs in Node.
- `js/app.js`: the page. While you are moving the frame it is drawn coarse so that it keeps up, and at full sharpness a moment after you stop. Exports are drawn a slice at a time so the page stays awake.
- No library, no WebGL, no outside request, nothing stored.

## Checks

From the site's root, with the site served on port 8779:

```bash
node demos/shot-framer/tools/pano.test.mjs
```

```bash
node demos/shot-framer/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8779
```

```bash
node demos/shot-framer/tools/shots.mjs http://127.0.0.1:8779 demos/shot-framer
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. `REVIEW.md` lists what each one proves and what nobody has checked.

## Honest limits

- A frame is drawn by the processor, not the graphics card. That keeps the screen and the exported file identical, but a 4K export takes a second or two, and dragging is drawn coarse on purpose.
- Pictures wider than 8192 pixels are scaled down to that before use.
- An exported frame can be no sharper than the 360 picture it comes from. A long lens on a small picture will be soft.
- "Export all" sends one file after another. Some browsers ask before allowing several downloads.
- The lens in millimetres takes the frame's shorter side as a full-frame sensor's 24 mm. It is a guide, not a calibration.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone, or with a real screen reader, and nobody has yet used it by hand. It has not been tried with a real 360 photograph, only with pictures made for the checks.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
