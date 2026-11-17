# Still Water

A walkable gallery in a set of empty, tiled pool rooms. Demo 5 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Quality bar it sets:** a first-person 3D place that anyone can get round: by walking, by pressing Next, by letting it walk you, or by choosing from a list, with the walking rules tested in Node before anything is drawn.
Use it as the reference for walkable 3D spaces and for hanging pictures in them.

## What it does

- Six rooms on one plan: a lobby, a long west gallery, a pool hall with pillars and skylights, two side rooms, and a flooded passage to a last room where one photograph hangs across the water.
- Twelve photographs in frames, each with a numbered plate and a lamp. No titles.
- Walk with the keyboard and drag to look. Letter keys are shortcuts only while the view has the focus. On a phone, the left of the screen is a stick to walk with and the right looks round.
- Pools shelve down from the dry floor, so you wade in. Water slows you and ripples round you.
- **Next** and **Previous** walk you to each photograph and stand you square in front of it, far enough back to see all of it on your screen.
- **Walk me round** visits all twelve in order and stops. Touch any control and you are walking yourself again.
- **All plates** is a plain list with thumbnails and descriptions, for anyone who would sooner choose than walk. It also repeats how to move and links back to the site.
- If the 3D rooms cannot start (no WebGL, the script fails to load, or scripts are off), the page shows the twelve photographs and their descriptions as an ordinary web page instead, with a link back to the site.
- A plan in the corner shows the rooms, the pools, the photographs and you.
- The panel names a photograph only when it is really on your screen, and says so plainly if a picture failed to load.
- Sound (off until you ask): the hush of a tiled room, a drip now and then, your steps, the water round your legs.
- With reduced motion set, Next cuts instead of gliding and the water is still. **Still the water** does the same on request.

## How it is put together

| File | Job |
|---|---|
| `js/world.js` | The plan of the rooms as text, where the photographs hang, and the rules for walking: walls, pillars, wading, routes between photographs. No drawing. |
| `js/build.js` | Turns the plan into walls, floors and ceilings, and works out the light once for every corner (skylights, a lamp per photograph, shadow in the corners). No drawing library. |
| `js/photos.js` | The twelve photographs and their descriptions. |
| `js/app.js` | The page: Three.js r160 (shared copy in `demos/_shared`), three small shaders (tiles and moving water-light, the water, shafts of daylight), controls, sound. |

To change the rooms, edit the `PLAN` in `world.js`: `#` wall, `.` floor, `~` pool, `*` and `%` skylights, `a` to `l` photographs. The tests say at once if a room is cut off or a photograph faces a wall.

## To hang Kol's own photographs

Replace the files in `img/` and the descriptions in `js/photos.js`, and copy the same file names and descriptions into the plain gallery (`<ol id="flat">`) at the foot of `index.html`; `world.test.mjs` fails until the two agree. Landscape pictures hang 1.5 m wide, portrait ones (marked `portrait: true`) 0.95 m wide. Then re-take the pictures in this folder with `tools/shots.mjs`, because the sharing image (`thumbnail.png`) shows two of the stand-ins on the walls.

## Checks

```bash
node demos/still-water/tools/world.test.mjs
```

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium node demos/still-water/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8772
```

The first checks the plan, the walking rules and the geometry in Node. The second drives the page in a browser (serve the repo root first). `tools/shots.mjs` re-takes the pictures in this folder.

## The photographs

**These are stand-in test images, their terms of reuse are not settled, and they must be replaced with Kol's own photographs before this page is merged or made public.** The page says the same on its start card, in the list of plates and in the plain gallery.

They are images 1, 2, 6, 7, 9, 11, 13, 16, 19, 21, 22 and 23 of the Kodak Lossless True Color Image Suite, chosen because none shows a person close up. What is known about permission, and no more:

- An archive page for the suite (r0k.us/graphics/kodak) says the images were released by the Eastman Kodak Company for unrestricted usage. These copies came from a public GitHub mirror whose README repeats that. Neither is Kodak's own statement.
- An outside review (17 November 2026) reports that a Kodak document published alongside the suite speaks instead of a grant to holders of Kodak's sampler disc, and of crediting the photographers with reproductions. That document was not read for this page and is not in the repo.
- The repo holds no licence, no grant and no photographer credits for any of the twelve.

So nothing here should be read as saying the images are public domain or free to reuse. Which terms apply is a question for Kol, not something the code can settle.

## Credit

The idea follows a post by Ben Springer showing a walkable "poolrooms" gallery (x.com/Ben__Springer/status/2119915615351693483). Nothing was copied from it: the plan, the rooms, the shaders and the look were written for this page.

## Status

Draft, and unlisted. The page carries `noindex`, is not in the demo gallery and is not in the sitemap. Unlisted does not mean private: the site deploys whatever is merged, so merging this would put the page on the live site at its own address (/demos/still-water/), unlisted but reachable by anyone with the link. It must not be merged while the stand-in photographs are on it. See `REVIEW.md` for what was checked and what was not.
