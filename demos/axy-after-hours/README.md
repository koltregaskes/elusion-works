# Axy Lusion After Hours

An experimental Axy Lusion homepage you can bend. Demo 2 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Quality bar it sets:** an experimental landing page where every visible thing is still real HTML (headings, links, buttons, a slider), drawn through a shader where the browser allows it, and fully usable as ordinary HTML where it does not.
Use it as the reference for landing pages and interface motion.

## The two rooms

- **Undertow.** A gravity well sits in the page. The headline, the copy, the buttons and the frames lean toward it. Drag the well, raise its mass, or press "Feed the well" and the page falls in piece by piece. Focus anything with Tab and it climbs back out.
- **Lamplight.** The gallery after closing. Eight frames hang on a plaster wall. Three lamps are real buttons: drag them, or move them with the arrow keys. Each has brightness and warmth, and the house lights can come up. The header and footer stay lit, like signage.

## Two versions in one page

| | HTML-in-Canvas on | Plain HTML |
|---|---|---|
| When | The browser has the experimental HTML-in-Canvas feature (Chromium with the feature switched on, for example inside Claude's desktop app) | Every other browser, or add `?plain` to the address |
| Undertow | The live page is drawn into a WebGL canvas. Text bends around the well, with colour fringing and a glowing ring | Pieces lean and fall with ordinary CSS transforms. The well is drawn behind the page |
| Lamplight | Relief lighting: paint, frames and plaster catch each lamp | Pools of light cut out of a dark overlay |
| Access | Same DOM in both, with real focus and screen-reader names. The shader never bends a link: each link is drawn exactly where it is clicked or tapped, and only the text and space around it bend (checked in the test browser with software graphics, not on a real device). The header, the controls and the footer are never bent | Same |

The status line at the bottom of the page says which version is running. If the canvas path fails at any point (the call throws, nothing paints within 1.5 seconds, the graphics context reports an error, or it is lost) the page is handed back as ordinary HTML.

## The frames

No archive images are bundled. The frames are generative tone studies, drawn in the browser from the colour record of real frames in the Axy Lusion archive (`data/homepage-gallery.json` in the axylusion repo). As on the archive, frames show a queue reference and never a title.

To use a real picture, put the file in this folder (for example `frames/F0006.jpg`) and add `image: 'frames/F0006.jpg'` to that entry in `FRAMES` at the top of `app.js`. Keep images in this folder: the site refuses pages that load from outside addresses. If a file fails to load, that frame shows its tone study dimmed, its reference reads "missing", and screen readers hear "Image did not load". This has been checked with a tiny test picture made by the test itself; no real Axy images have been added yet, and the About text still describes the frames as stand-ins, so change it when real images go in.

## Credits and rights

- Inspired by Felix Rieseberg's HTML-in-Canvas demos (https://x.com/felixrieseberg/status/2122036839238492493). This is a separate, original piece: none of his concepts, code or assets are used.
- Fonts: Outfit, Plus Jakarta Sans, JetBrains Mono, SIL Open Font License 1.1 (each font's full licence text is in `fonts/`).
- Axy Lusion name, palette and type choices are Kol's own.

## Files

- `index.html`: page and styles.
- `app.js`: frames, physics, lamps, the shader, and the hand-over between the two versions.
- `fonts/`: three variable fonts, Latin subset.
- `tools/`: checks (not shipped). They need Playwright and a static server serving the repo root (port 8765 unless told otherwise).
  - `node demos/axy-after-hours/tools/smoke.mjs <path to axe.min.js> [base address]` runs both versions. The axe file is required. The HTML-in-Canvas version is switched on in the test browser with Chromium's `CanvasDrawElement` feature, using software graphics.
  - `BASE=<base address> node demos/axy-after-hours/tools/shots.mjs <out folder> name:canvas|plain:undertow|lamplight:WxH[:feed|feedlong]` takes pictures.

## Status

Unlisted draft. The page carries `noindex` and is not in the gallery or the sitemap. The site deploys whatever is merged, so merging this would put the page on the live site at its own address: unlisted, but reachable by anyone who has the link. To release it properly: remove the `noindex` line, add the gallery card in `demos/index.html` and the route in `sitemap.xml`. Kol approves publishing.
