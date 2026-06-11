---
version: alpha
name: Nebula Architect
description: Dark glassmorphic control-room interface with a copper primary and neon secondary accents — timeline, radar, and panel system.

colors:
  bg-dark: "#020207"
  panel: "#0d0e1b"
  panel-raised: "#121327"
  copper: "#d7a16f"
  magenta: "#ff3b99"
  cyan: "#00f5d4"
  violet: "#8b5cf6"
  text-primary: "#f5f8ff"
  text-secondary: "#aebbe6"
  text-muted: "#6e79a3"
  glass-border: "#d7a16f2e"

typography:
  display:
    fontFamily: Space Grotesk
  body:
    fontFamily: Inter
  mono:
    fontFamily: IBM Plex Mono

rounded:
  sm: 10px
  md: 16px
  lg: 24px

components:
  glass-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  alert:
    textColor: "{colors.magenta}"
---

## Overview
A dark glassmorphic "control room" interface — timeline and radar widgets, raised glass panels, copper-and-neon accent system. Origin: Elusion Works demo (no Claude Design bundle found; tokens from `styles.css`). Includes a mobile touch-usability fix for the timeline and radar.

## Colors
Near-black base (`#020207`) with translucent glass panels. **Copper (`#d7a16f`) is the primary accent** (borders, glow), with neon secondaries: magenta (alerts), cyan, violet. Text in three blue-white tiers. Copper + neon over glass is the signature.

## Typography
**Space Grotesk** display, **Inter** body, **IBM Plex Mono** for readouts/data.

## Layout
Control-room dashboard: glass panels over a dark field, timeline and radar as interactive widgets. Static site. The timeline/radar are touch-enabled — verify gestures on a real touch device.

## Elevation & Depth
Glassmorphism — translucent panels (`glass-bg`), copper-tinted borders that brighten on hover, and copper/neon glow shadows for depth.

## Shapes
Radius 10 / 16 / 24px on panels and controls.

## Components
Glass panel, timeline (touch-draggable), radar (touch), alert (magenta), data readouts (mono).

## Do's and Don'ts
- ✅ Copper is primary; neon (magenta/cyan/violet) is secondary and sparing.
- ✅ Keep the timeline/radar usable on touch (the shipped fix — don't regress it).
- ❌ No light mode; glass depends on the dark base.
