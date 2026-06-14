# Neon Seraph: Blackout Protocol

## Purpose

Portfolio landing-page demo for an original AAA-style isometric cyberpunk action
game. The brief was to make the first viewport memorable, include a real video
element, and show dynamic interaction patterns without copying existing game IP.

## Fictional Game Concept

`Neon Seraph: Blackout Protocol` is a fictional isometric sci-fi action game set
inside Eidolon Spire, a rain-soaked arcology after a citywide power failure. The
player commands a winged breach rig through tactical arenas, drone systems,
district blackouts, and faction conflict.

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

The page is built as a blackout command surface: a full-bleed procedural trailer
loop is the anchor, while the rest of the page behaves like a tactical dossier.
The palette avoids a one-note purple/blue cyberpunk treatment by mixing bone,
acid chartreuse, sodium amber, magenta, teal, red, and black.

## Original Assets

- `assets/seraph-trailer-loop.webm`: generated locally from a Playwright/Edge
  canvas recording. No paid generation or borrowed footage.
- `assets/poster.webp`: extracted from the trailer loop with ffmpeg.
- `thumbnail.webp`: extracted from the trailer loop for the Elusion Works demos
  index.
- `assets/seraph-mark.svg`: original vector mark made for the demo.

## Interactions

- Hero video play/pause.
- Reduced-motion toggle and `prefers-reduced-motion` support.
- Interactive isometric district scanner.
- Faction dossier tabs.
- Loadout carousel.
- Static watchlist form with local status text.
- Scroll reveal and compact sticky header.

## Reusable Cinematic Landing-Page Pattern

Use this pattern when translating an AI-generated landing-page direction into
repo-owned static code:

1. Start with a fictional, original property. Capture the genre, playable
   fantasy, setting, enemy pressure, and one memorable visual hook before any
   layout work.
2. Make the first viewport product-led: logo, short premise, trailer/media
   surface, direct CTA, platform/status strip, and one system card. Avoid a
   generic marketing hero.
3. Build sections as game systems, not content blocks: world scanner, combat
   loop, faction/readout tabs, equipment carousel, launch CTA, and footer.
4. Use one real motion anchor. For static sites, a compressed looped WebM plus
   poster is more reliable than dozens of scroll libraries.
5. Keep all interactive state client-side and reversible. The demo should work
   without accounts, APIs, tracking, or a backend.
6. Add a reduced-motion path before verification. Pause video/animations when
   requested and keep the page readable without motion.
7. Verify desktop and mobile with screenshots, console checks, horizontal
   overflow checks, and at least one click path through every interactive
   component.

### Source-Tool Lessons

Fable/Aura-style tools are strongest at fast cinematic composition, bold section
stacking, dense art direction, and turning a compact prompt into a cohesive
visual pitch. They are weaker as production owners: generated output still needs
asset provenance, responsive QA, accessibility, performance checks, repo-safe
metadata, and code that can be maintained without the tool.

### Prompt Shape

```text
Create an original cinematic landing page for [fictional property].
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
scanner, faction tabs, loadout carousel, and reduced-motion mode.
