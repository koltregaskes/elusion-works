---
version: alpha
name: Solar System Field Lab
description: Live Three.js orbit lab — distance modes, fullscreen flyby, planet pages, scale tools and a classroom quiz. Dual light/dark theme.

colors:
  bg-dark: "#050811"
  bg-dark-2: "#080c18"
  bg-light: "#eef1f7"
  bg-light-2: "#e3e8f2"
  accent-dark: "#f3a14a"
  accent-light: "#d97a3e"
  accent-2: "#b85e26"
  ink-dark: "#eef2fb"
  ink-light: "#0a1024"

typography:
  body:
    fontFamily: Inter
  display:
    fontFamily: Space Grotesk

rounded:
  sm: 12px
  md: 18px
  lg: 26px

components:
  panel:
    backgroundColor: "{colors.bg-dark-2}"
---

## Overview
The most technical demo: a live **Three.js** orbit lab with distance modes, fullscreen flyby, per-planet pages, scale tools, and a classroom quiz. Origin: Claude Design bundle (extracted at `W:\Websites\claude-designs\extracted\solar-system-field-lab\`). Tokens derived from its CSS.

## Colors
**Dual theme.** Dark mode: near-black navy base (`#050811`) with warm amber accent (`#f3a14a`) and near-white ink. Light mode: cool paper (`#eef1f7`) with a deeper burnt-orange accent (`#d97a3e`) and near-black ink. Ink scales to four tiers per mode.

## Typography
**Space Grotesk** display, **Inter** body — matches the sibling Solar System demo's education register.

## Layout
WebGL canvas centrepiece with overlaid control panels and planet detail pages. Note: WebGL/Three.js content; verify in a real browser, not a screenshot.

## Elevation & Depth
Soft panel shadows over the canvas; theme-aware so light mode uses lighter shadows.

## Shapes
Radius 12 / 18 / 26px.

## Components
Orbit lab (Three.js), distance-mode switch, flyby, planet pages, scale tools, quiz, theme toggle.

## Do's and Don'ts
- ✅ Keep both themes in sync — every surface needs a light and dark value.
- ✅ Amber/burnt-orange is the single accent; don't add a second hue.
- ❌ Don't assume dark-only; this demo is the estate's dual-theme example.
