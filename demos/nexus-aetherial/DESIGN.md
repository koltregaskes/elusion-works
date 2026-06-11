---
version: alpha
name: Nexus Aetherial
description: Split-flap / anatomy-board aesthetic with three modes (light, dark, sepia) and a monospace-led editorial register.

colors:
  ink-light: "#0d0f17"
  ink-dark: "#f0f2f8"
  ink-sepia: "#1a1410"
  ink-soft-light: "#353a4d"
  ink-soft-dark: "#c5c9d6"
  ink-faint: "#6b7184"
  ink-ghost: "#a8aebf"

typography:
  mono:
    fontFamily: JetBrains Mono
  mono-alt:
    fontFamily: IBM Plex Mono

rounded:
  sm: 8px
  md: 16px

components:
  flap:
    textColor: "{colors.ink-dark}"
---

## Overview
A split-flap-display / anatomy-board aesthetic. Notable for shipping **three colour modes** — light, dark, and sepia — each with a full ink scale. Origin: Claude Design bundle (`Nexus Aetherial-handoff.zip`, extracted at `W:\Websites\claude-designs\extracted\nexus-aetherial\`). Tokens from `anatomy.css`.

## Colors
Mode-driven **ink scales** rather than fixed colours: each mode (light `#0d0f17`, dark `#f0f2f8`, sepia `#1a1410`) defines primary ink plus soft / faint / ghost tiers. The design is type-and-ink led; chroma is minimal.

## Typography
Monospace-forward: **JetBrains Mono** (primary) and **IBM Plex Mono** (fallback). The split-flap motif and labels rely on the mono grid.

## Layout
Anatomy-board panels with split-flap rows. Static site.

## Elevation & Depth
Two custom shadows: `shadow-card` (subtle 1px + lift) and `shadow-flap` (inset top-light + hard bottom edge) that give the flaps physical depth.

## Shapes
Tight radii (8–16px) — the flap/board motif is rectilinear.

## Components
Split-flap rows, anatomy panels, mode switcher (light/dark/sepia).

## Do's and Don'ts
- ✅ Keep all three modes complete — every ink tier needs a value per mode.
- ✅ Monospace carries the identity; don't introduce a proportional display face.
- ❌ Don't add bright accents; this design is ink-and-depth, not chroma.
