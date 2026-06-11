---
version: alpha
name: The Last Cartridge
description: Cinematic digital-artefact exhibition for a fictional lost 16-bit cartridge — boot sequence, world hotspots, recovered profiles, gameplay stills, soundtrack fragments and archive objects.

colors:
  bg-0: "#070814"
  bg-1: "#0d1020"
  bg-2: "#14182a"
  accent-cyan: "#5de3ff"
  accent-magenta: "#ff4fd8"
  accent-amber: "#ffb84a"
  accent-green: "#89ff8c"
  border-soft: "#b4c4ff2e"

typography:
  body:
    fontFamily: Inter
  display:
    fontFamily: Arial Black
  pixel:
    fontFamily: Lucida Console

rounded:
  xs: 6px
  sm: 10px
  md: 16px
  lg: 24px
  xl: 32px
---

## Overview
A dark retro-futurist exhibition for a fictional lost 16-bit cartridge: boot overlay, world map with hotspots, recovered character profiles, gameplay stills, soundtrack fragments, archive gallery. Tokens from `styles.css`.

## Colors
Near-black blue-violet base in three tiers, with four neon arcade accents (cyan, magenta, amber, green) evoking CRT phosphor. Accents are used as glowing highlights and hotspot markers.

## Typography
Three families by role: **Inter** body, **Arial Black** display (heavy retro-poster weight), **Lucida Console** pixel/mono for terminal and archive-label text.

## Layout
Boot sequence → world map → archive sections. Static site, no build step.

## Elevation & Depth
Deep shadow `0 28px 90px rgba(0,0,0,0.38)`; soft 18%-alpha blue borders.

## Shapes
Wide radius scale 6–32px; tighter radii on pixel/terminal elements.

## Components
Boot overlay, world hotspot map, recovered-profile cards, gameplay-still gallery, soundtrack fragments.

## Do's and Don'ts
- ✅ Neon accents glow; pair them with the dark base for CRT feel.
- ✅ Reserve the pixel font for terminal/archive-label moments, not body.
- ❌ No light mode. Don't dilute the four-accent arcade palette.
