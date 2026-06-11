---
version: alpha
name: Solar System
description: Interactive education mini-site about the solar system — orbit lab, planet explorer, comparison tools, scale model, and quiz, on a deep-space dark palette with multi-hue accents.

colors:
  bg: "#040713"
  bg-2: "#080d21"
  bg-3: "#0d1732"
  accent-cyan: "#78f3ff"
  accent-violet: "#bb8cff"
  accent-amber: "#ffe083"
  accent-mint: "#8dffcb"

typography:
  body:
    fontFamily: Inter
  display:
    fontFamily: Space Grotesk

rounded:
  sm: 12px
  md: 18px
  lg: 24px
  xl: 34px

components:
  panel:
    backgroundColor: "{colors.bg-2}"
---

## Overview
Static interactive STEM mini-site: orbit lab, planet explorer, comparison tools, scale model, dwarf-planet dock, quiz, with visible NASA/JPL/IAU source notes. Tokens derived from `styles.css`.

## Colors
Three-stop deep-space background (`#040713 → #0d1732`) with four cool/warm accents (cyan, violet, amber, mint) used to differentiate planets and data series. Multi-accent by design — unlike the single-accent demos.

## Typography
**Space Grotesk** display, **Inter** body — a technical-but-friendly pairing for an education audience.

## Layout
Tool-panel grid with an interactive orbit canvas. Static site, no build step.

## Elevation & Depth
Deep soft shadow `0 26px 90px rgba(0,0,0,0.5)` for floating panels over the starfield.

## Shapes
Radius scale 12 / 18 / 24 / 34px across cards, panels, and the hero shell.

## Components
Orbit lab canvas, planet explorer cards, comparison tools, scale model, quiz.

## Do's and Don'ts
- ✅ Use the four accents to encode planets/data, not decoration.
- ✅ Keep the source notes (NASA/JPL/IAU) visible — it's an education credibility cue.
- ❌ No light mode; the starfield depends on the dark base.
