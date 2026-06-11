---
version: alpha
name: Atmosphere
description: Weather app demo with dynamic, condition-driven backgrounds and a calm single-accent foreground.

colors:
  accent: "#c2410c"
  text: "#f5f3ee"
  text-soft: "#f5f3eeb3"
  text-faint: "#f5f3ee73"

typography:
  body:
    fontFamily: Inter

rounded:
  md: 16px
  lg: 24px
  pill: 999px
---

## Overview
A weather application demo whose **background is driven by the current condition** (clear, cloud, rain, night) rather than a fixed palette. Foreground stays constant: warm off-white text over a single burnt-orange accent. Origin: Claude Design bundle (`Atmosphere-handoff.zip`, extracted at `W:\Websites\claude-designs\extracted\atmosphere\`). Tokens from its CSS.

## Colors
The palette is deliberately minimal in tokens because the **backdrop is dynamic** — condition-driven gradients. The fixed tokens are the foreground: warm off-white text in three opacity tiers (`text` / `text-soft` / `text-faint`) and a single burnt-orange accent (`#c2410c`).

## Typography
**Inter** throughout — the data (temperature, conditions) does the visual work, so the type stays neutral.

## Layout
Full-viewport weather stage with an overlaid current-conditions panel and forecast strip. Static site.

## Elevation & Depth
Foreground panels float on translucent layers over the dynamic background; depth comes from blur/alpha rather than hard shadow.

## Shapes
Rounded panels (16–24px) and pill controls.

## Components
Current-conditions panel, forecast strip, condition-driven background system.

## Do's and Don'ts
- ✅ Let the background carry the colour; keep the foreground calm.
- ✅ Use text-opacity tiers for hierarchy, not new colours.
- ❌ Don't hardcode a background colour — it's condition-driven.
