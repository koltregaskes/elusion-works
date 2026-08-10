---
version: alpha
name: Void Sovereign
description: Universe-scale 3D space RTS in the browser — procedural fleets, procedural nebulae, hairline vector HUD over a near-black void.

colors:
  void: "#04070c"
  ink: "#dfe8f2"
  dim: "rgba(223, 232, 242, 0.52)"
  faint: "rgba(223, 232, 242, 0.16)"
  player: "#7fd8e8"
  enemy: "#e8a44a"
  warning: "#ff6b4a"
  hull-base: "#8d8f8c"

typography:
  display:
    fontFamily: Inter
    weight: 700
  body:
    fontFamily: Inter
  mono:
    fontFamily: IBM Plex Mono

rounded:
  sm: 0px
  md: 0px
  lg: 0px

components:
  hud-rule:
    borderColor: "{colors.faint}"
  readout:
    fontFamily: "{typography.mono.fontFamily}"
    textColor: "{colors.dim}"
---

## Overview

A Homeworld-lineage skirmish RTS built on Three.js, running as a static page with
**zero binary art assets**. Every hull, nebula, asteroid, texture and sound is
generated at runtime from a single seed — `?seed=kharak` rebuilds the identical
universe every time. Thirteen ship classes across three hull families, full 3D
fleet movement, and an AI commander with its own economy.

Architecture and module boundaries live in [ARCHITECTURE.md](./ARCHITECTURE.md),
which is the binding contract for the codebase.

## Colours

Near-black void (`#04070c`) is the substrate — the game is mostly empty space and
that is the point. **Colour comes from three sources only**: the nebula backdrop,
engine and weapon emissives, and team trim. Hulls are desaturated bone-grey and
never take a team tint across their whole surface — only painted bands do.

Player reads cold (cyan/white/steel); the enemy reads warm (amber/crimson/rust).
Sky palettes are seeded from eight hand-tuned sets (`cindervault`, `emberfall`,
`coldwater`, `ironmoth`, `ochrewake`, `nightbloom`, `saltmarsh`, `deepfathom`),
each restricted to two dominant hues plus one accent.

## Typography

**Inter** for prose and the title card, **IBM Plex Mono** for every numeric
readout, label and key hint. Mono is used generously — it is the game's voice.

## Layout

Full-bleed canvas with a thin overlay. The HUD never boxes the void in: hairline
rules, corner ticks and generous negative space instead of filled panels. Bottom
left is reserved for the "← Demos" exit link.

## Elevation & Depth

No cards, no shadows, no gloss. Depth is expressed in the 3D scene — a single
hard key star with a nebula-tinted fill, atmospheric haze over kilometres, and
greeble density that scales with hull length so a 1,900 m mothership reads as
135× a 14 m interceptor.

## Shapes

Square. Radius 0 everywhere. The only curves in the UI are progress rings on the
production queue.

## Rendering notes

- Two scenes: a backdrop (`farScene`) drawn first with its own camera and a huge
  far plane, then a depth clear, then gameplay. Without this the backdrop fights
  a 14 m fighter for depth precision.
- The sky is baked once into an **equirectangular** map, not a cubemap. WebGL 2
  has no seamless cube filtering, so every one of the twelve cube edges showed as
  a visible step against the nebula — measured at 3–5 luminance units on a sky
  whose range is only 1–25. A lat/long map has no internal seams.
- Sky map height is chosen for angular resolution, not memory: 2048 (→ 4096 wide)
  gives ~0.088°/texel, about two screen pixels at 1080p, which is where stars
  read as points rather than blobs.
- Fixed 30 Hz simulation with interpolated rendering, so capitals glide.

## Do's and Don'ts

- ✅ Colour from nebula, engines and trim. Hulls stay grey.
- ✅ Bloom on emissives only — engines, beams, explosions, star cores. Never hulls.
- ✅ Keep at least a third of the sky honestly empty.
- ✅ British English in all user-facing copy.
- ❌ No binary art assets, ever. If it cannot be generated, it does not ship.
- ❌ No filled UI panels over the 3D view.
- ❌ No light mode. The whole design depends on the near-black base.
