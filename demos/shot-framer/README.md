# Shot Framer

Look round a 360 picture, frame it the way a camera would, save a list of shots, and export each one as a picture. Six frame shapes from cinema to tall, a lens you can change, and a shot list in plain words. Demo 12 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by Runway](https://x.com/runwayml/status/2119874555581694370) about framing shots inside a 360 picture. An original tool, not made by or with Runway.

**Quality bar it sets:** a picture tool whose every pixel comes from one piece of arithmetic that runs without a browser, so the frame on screen and the file that comes down can both be compared, pixel for pixel, with the same frame drawn again by the checks.
Use it as the reference for image tools and anything that exports files.

## What it does

- **Look round.** Drag the picture, or use the arrow keys. What you take hold of stays under your finger, at any lens and any tilt: the view is worked out so that it does.
- **Change the lens.** Scroll over the picture, pinch, use plus and minus, or move the slider. On a narrow window, where the page has to be scrolled past the picture, the wheel changes the lens only once the picture is selected.
- **The lens in millimetres** is the lens a full-frame camera would need, with the frame fitted inside its 36 by 24 mm sensor, turned on its side for a tall shape. Changing the shape keeps the lens, as turning a camera does.
- **Choose a shape.** 16:9, 2.39:1, 4:3, 1:1, 4:5 or 9:16. The frame on screen is the shape of the picture you will get.
- **Save shots.** Each is listed with a small picture and a line a director could read out: "Shot 1: facing east (90°), 8° up, 23 mm lens, 16:9". The list can be copied as text.
- **Export.** Any shot, or the frame in hand, as a PNG with its longer side 1920 or 3840 pixels. The picture is drawn again at full size from the whole 360 picture, not copied from the screen. One file is drawn at a time, from the picture that was loaded when it began. Saved shots are named `shot-01-…`; the frame in hand, exported without saving, is `frame-01-…`.
- **Use your own 360 picture.** Choose a file or drop one on the page. It is opened on your own device and is not uploaded. Its middle is taken as straight ahead, as 360 cameras make them, and its shots are described as ahead, right, behind and left, since nobody knows where its north is. A picture that is not twice as wide as it is tall is used with a warning; one smaller than 64 by 32 is refused. Saved shots are kept when the picture changes: a shot is a direction and a lens.
- **The sample.** A sculpture park at night: a slab to the north, an arch to the east, three balls to the south, a flight of blocks to the west, a moon in the north-east. It is worked out by the page, a direction at a time, at 4096 by 2048, with every edge smoothed; no picture file is loaded. A small version shows at once and the full one replaces it when it is ready.

## How it is made

- `js/pano.js`: the arithmetic. Which way each point of a frame looks, where that falls in a 360 picture, the lens in millimetres, the view that keeps a dragged point under the pointer, export sizes, and the drawing of a frame pixel by pixel. A wide lens on a large picture reads from a smaller copy of it, made when first needed, so that fine detail does not shimmer. Also the sample picture. No page and no drawing surface, so it all runs in Node.
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

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- A frame is drawn by the processor, not the graphics card. That keeps the screen and the exported file identical, but a 4K export takes a few seconds, longer on a slow device or while the sample is still being worked out, and dragging is drawn coarse on purpose.
- Pictures wider than 8192 pixels or taller than 4096 are scaled down to that before use. A very large picture needs a few hundred megabytes of memory while it is open.
- An exported frame can be no sharper than the 360 picture it comes from. A long lens on a small picture will be soft.
- "Export all" sends one file after another. Some browsers ask before allowing several downloads.
- The lens in millimetres assumes the frame is a crop of a full-frame sensor. It is a guide, not a calibration.
- The smaller copies that stop shimmer are chosen for the middle of the frame. Looking nearly straight up or down through a very wide lens, the corners can still shimmer a little.
- On a phone held sideways the frame is small, and the controls are below it.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox, on a real phone, or with a real screen reader, and nobody has yet used it by hand. It has not been tried with a real 360 photograph, only with pictures made for the checks.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
