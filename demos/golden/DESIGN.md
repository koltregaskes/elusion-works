---
version: alpha
name: Golden
description: Premium breed-encyclopedia concept for the Golden Retriever — a dark, editorial, gold-accented mini-site with a cinematic hero, image-led sections, gallery, and guide pages.

colors:
  bg: "#080d10"
  bg-deep: "#05070a"
  gold: "#d4af37"
  gold-strong: "#8a6723"
  border: "#3a2c12"
  text-primary: "#f3e9d6"
  text-secondary: "#b8aa91"
  text-muted: "#746b5b"

typography:
  display:
    fontFamily: Cormorant Garamond
  ui:
    fontFamily: Inter

rounded:
  sm: 8px
  md: 16px
  lg: 24px

components:
  panel:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.text-primary}"
---

## Overview
A static, dark, editorial mini-site presenting the Golden Retriever as a premium breed encyclopedia: cinematic homepage, breed-guide, gallery, and supporting pages. Prototype, not a live publication. Origin: Elusion Works demo (pre-dates the DESIGN.md standard; tokens derived from `home.css` / `breed-guide.css`).

## Colors
Near-black charcoal base (`bg` / `bg-deep`) with a single warm gold accent (`#d4af37`, used via low-alpha rgba for glows and via `gold-strong` for solid edges). Warm off-white text in three tiers. Restrained — gold is the only chroma.

## Typography
Two families: **Cormorant Garamond** (display serif, headings — the editorial signature) and **Inter** (UI/body). Large serif headlines against calm sans body.

## Layout
Cinematic full-bleed hero, then image-led editorial sections and a gallery grid. Static GitHub Pages site, no build step.

## Elevation & Depth
Soft gold glow shadows (`0 0 36px rgba(212,175,55,0.08)`) rather than hard drop shadows; 1px borders in gold-tinted alpha.

## Shapes
Soft radii (8–24px) on cards and media frames.

## Components
Hero, breed-guide article sections, gallery, shared header/footer chrome.

## Do's and Don'ts
- ✅ Keep gold as the single accent; vary it by opacity, not hue.
- ✅ Serif display, sans body — don't swap.
- ❌ No second accent colour. No light mode.
