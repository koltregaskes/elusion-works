# Neon Seraph: Blackout Protocol

## Purpose

Cinematic landing page for an original AAA-style isometric cyberpunk action
game. The brief is to make the first viewport memorable, use a real trailer as
full-bleed atmosphere, and show game-native interaction patterns without copying
existing IP.

## Game Pitch

`Neon Seraph: Blackout Protocol` is an isometric sci-fi action game set inside
Eidolon Spire, a rain-soaked arcology after a citywide power failure. The player
commands a winged breach rig through tactical arenas, drone systems, district
blackouts, and faction conflict.

## Reference Lessons

Reference pass used these public pages:

- Cyberpunk 2077: trailer and buy CTA are first-class, with platform icons and
  a wider universe/newsletter structure.
- The Ascent: the best fit for the genre brief; it sells an arcology, co-op,
  explosive shooter systems, RPG elements, press quotes, and a vibrant world.
- RUINER: short, aggressive copy, red/black attitude, trailer-first entry, and
  enemy/feature/GIF sections.
- Ghostrunner 2: terminal language, edition/store panels, video highlights, and
  cyberpunk system copy.
- Hades II: compact trailer/media library with multiple trailers and image
  assets kept close to the product page.
- DOOM: The Dark Ages: direct high-impact headings and feature blocks that feel
  like combat verbs, not generic marketing.
- Marathon: strong sci-fi world pitch, extraction loop, and tight buy CTA.
- ARC Raiders: spare, memorable line breaks with a world premise that is easy to
  repeat.
- Game Developer landing-page guidance: headline, hero/trailer, CTA, press,
  social proof, and about/game characteristics.

## Design Thesis

The page is built as a blackout command surface: a full-bleed trailer loop is
the anchor, while the trailer itself lives on its own `/trailer/` route instead
of being duplicated in a framed hero panel. The rest of the page behaves like a
tactical dossier. The palette avoids a one-note purple/blue cyberpunk treatment
by mixing bone, acid chartreuse, sodium amber, magenta, teal, red, and black.

## Original Assets

- `assets/neon-seraph-reveal.mp4`: 10.1 second AI-generated cinematic reveal
  trailer using Seedance 2.0 Pro via the Magnific MCP. It is H.264 1920x1080
  with AAC audio and sound effects.
- `assets/key-art.jpg`: AI-generated key art used as the source image.
- `assets/poster.webp`: cropped and compressed poster frame derived from the
  key art.
- `thumbnail.webp`: cropped and compressed thumbnail derived from the key art.
- `assets/seraph-mark.svg`: original vector mark made for this page.
- `assets/isometric-concepts/fixed-camera/`: generated fixed-camera isometric
  game plates used for the route skin, location gallery, and Seraph rig section.
  The visible gallery uses the strongest consistent-angle plates and leaves
  weaker angle tests unreferenced.
- `assets/isometric-concepts/individual/`: earlier environment explorations
  retained as source material; only the dockyard plate is used inside the 3D
  route as a distant route-skin surface.

## Interactions

- Hero video play/pause.
- Dedicated full-screen trailer page at `trailer/`.
- Reduced-motion toggle and `prefers-reduced-motion` support.
- Scroll-pinned Three.js isometric route: Seraph moves through a procedural
  city/arena/forest environment as page scroll progress advances.
- Route chapter markers update automatically as the visitor scrolls. The scene
  is deliberately cinematic rather than manually controllable.
- Procedural world elements include isometric tiles, city towers, arena pylons,
  gantries, overhead cables, animated signal planes, forest-sector hardware,
  enemy markers, rain particles, route line, relay exit, and a small wing-rig
  player model.
- The 3D route is skinned with the generated fixed-camera plates as in-world
  surfaces, then layered with procedural geometry, facade light bands, decals,
  and lights.
- Character spec section for the Seraph rig, using the grounded operator art as
  a production-facing player silhouette.
- Location plate gallery using generated concept images so art assets support
  the page rather than replacing the interactive scene.
- Interactive isometric district scanner.
- Faction dossier tabs.
- Loadout carousel.
- Platform wishlist cards.
- Scroll reveal and compact sticky header.

## Reusable Cinematic Landing-Page Pattern

Use this pattern when translating an AI-generated landing-page direction into
repo-owned static code:

1. Start with an original property. Capture the genre, playable fantasy,
   setting, enemy pressure, and one memorable visual hook before any layout work.
2. Make the first viewport product-led: logo, short premise, full-bleed motion
   anchor, direct CTA, platform/status strip, and one system hook. Avoid a
   generic marketing hero.
3. Build sections as game systems, not content blocks: world scanner, combat
   loop, faction/readout tabs, equipment carousel, launch CTA, and footer.
4. Use one real motion anchor. For static sites, a compressed looped MP4/WebM
   plus poster is more reliable than dozens of scroll libraries.
5. For isometric game pages, demonstrate the camera and player fantasy directly.
   Screenshots are supporting art; the main feature should be an animated game
   view where scroll moves the character and environment state forward.
6. Keep all interactive state client-side and reversible. The page should work
   without accounts, APIs, tracking, or a backend.
7. Add a reduced-motion path before verification. Pause video/animations when
   requested and keep the page readable without motion.
8. Verify desktop and mobile with screenshots, console checks, horizontal
   overflow checks, and at least one state change through every animated or
   interactive component.

### Source-Tool Lessons

Fable/Aura-style tools are strongest at fast cinematic composition, bold section
stacking, dense art direction, and turning a compact prompt into a cohesive
visual pitch. They are weaker as production owners: generated output still needs
asset provenance, responsive QA, accessibility, performance checks, repo-safe
metadata, and code that can be maintained without the tool.

### Prompt Shape

```text
Create an original cinematic landing page for [property].
Genre: [specific genre and camera/gameplay reference].
World hook: [one concrete setting conflict].
First viewport: logo, short premise, trailer/media surface, direct CTA,
platform/status strip, and one tactical/system card.
Sections: world/system scanner, combat loop, factions/characters, loadout or
feature carousel, launch/signup CTA, footer.
Style: [palette], [materials], [lighting], [motion language].
Constraints: original IP only, no borrowed assets, static-first HTML/CSS/JS,
reduced-motion support, mobile layout, no backend, no tracking.
Acceptance: desktop/mobile screenshots, no console errors, no horizontal
overflow, every interaction verified.
```

## Verification Target

Verify at:

- desktop: `1440x1000`
- mobile: `390x844`

Check video playback, console errors, text overlap, CTA usability, district
scanner, scroll-pinned 3D isometric route, faction tabs, loadout carousel, and
reduced-motion mode.

Latest local verification evidence:

- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final2\desktop-hero.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final2\desktop-rig-anchor.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final2\desktop-worlds-anchor.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final2\mobile-iso.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final2\mobile-rig.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final3\desktop-iso-city.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final3\desktop-iso-arena.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final3\desktop-iso-forest.png`
- `W:\websites\sites\elusion-works\.local\verification\neon-seraph-20260704-final4\desktop-iso-forest.png`

Current browser audit, 2026-07-04:

- Local URL: `http://127.0.0.1:8124/demos/neon-seraph/?v=20260704-final2`
- Hero video: `readyState=4`, playing, `1920x1080`, no media error.
- WebGL route: rendered without fallback; corrected scroll captures reached
  Stack 09 at `10%`, Saint Gate at `48%`, and Blackwood at `83%`.
- Desktop: `1440x1000`, no horizontal overflow, no console/page errors, no
  forbidden mock-up/demo/fictional copy, no manual route controls.
- Mobile: `390x844`, no horizontal overflow, no console/page errors.
- Anchor polish: Rig and Worlds headings land below the fixed header; no top
  clipping in current screenshots.

Local preview note: `.local\serve-static.cjs` supports byte-range and HEAD
requests for MP4 previews. Without this, Chromium may fail to load the hero
video metadata from local NAS-backed previews even though the file exists.
