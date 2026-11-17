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
| Access | Same DOM in both. Links, buttons and sliders keep real focus, hit testing and screen-reader names | Same |

The status line at the bottom of the page says which version is running. If the canvas path fails at any point (the call throws, nothing paints within 1.5 seconds, or the graphics context is lost) the page is handed back as ordinary HTML.

## The frames

No archive images are bundled. The frames are generative tone studies, drawn in the browser from the colour record of real frames in the Axy Lusion archive (`data/homepage-gallery.json` in the axylusion repo). As on the archive, frames show a queue reference and never a title. To use real frames instead, set each `FRAMES` entry's image in `app.js`.

## Credits and rights

- Inspired by Felix Rieseberg's HTML-in-Canvas demos (https://x.com/felixrieseberg/status/2122036839238492493). This is a separate, original piece: none of his concepts, code or assets are used.
- Fonts: Outfit, Plus Jakarta Sans, JetBrains Mono, SIL Open Font License 1.1 (each font's full licence text is in `fonts/`).
- Axy Lusion name, palette and type choices are Kol's own.

## Files

- `index.html`: page and styles.
- `app.js`: frames, physics, lamps, the shader, and the hand-over between the two versions.
- `fonts/`: three variable fonts, Latin subset.
- `tools/`: checks (not shipped). They need Playwright and a static server on port 8765 serving the repo root. `smoke.mjs` runs both versions.

## Status

Unlisted. The page carries `noindex` and is not in the gallery or the sitemap. To release it: remove the `noindex` line, add the gallery card in `demos/index.html` and the route in `sitemap.xml`. Kol approves publishing.
