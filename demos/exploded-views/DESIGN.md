---
version: "0.4.0"
name: Exploded Views
description: Three CAD-style interactive explorers — a laptop teardown, a solar-system orrery, and a turbofan engine — sharing one technical-illustration chassis.

colors:
  bg-dark: "#0e1116"
  bg-light: "#eef1f5"
  panel-dark: "rgba(20, 24, 31, 0.88)"
  panel-light: "rgba(255, 255, 255, 0.88)"
  accent-dark: "#ff7a1a"
  accent-light: "#ff6a00"
  ink-dark: "#e8eaee"
  ink-light: "#1a1d21"

typography:
  ui:
    fontFamily: "Inter"
    role: "Every surface — breadcrumbs, panel labels, toggles, value pills, inspector chips"

performance:
  runtime: "Static HTML, CSS, and ES modules — no build step, no framework"
  dependency: "Three.js 0.165 via jsDelivr import map"
  scriptTarget: "Inline per page; no bundler"
---

# Exploded Views Design System

## Visual thesis

A precision-instrument reading of a CAD workspace: near-black or near-white ground, a frosted control panel pinned right, a breadcrumb top bar, and a single orange accent doing all the signalling. The subject floats in empty space with nothing competing for attention.

## The Morpheus line

Every mesh carries a thin dark edge outline over its light surface. This is the defining move of the set — it reads as technical illustration rather than a game render, and it is what makes a grey plastic laptop shell legible. Implemented as `EdgesGeometry` overlays, toggled by "Edge lines" in the panel. It is not decoration and should not be dropped.

## Content plan

1. **Hub (`index.html`):** three cards, one per explorer, with a gradient tile standing in for each subject.
2. **Laptop (`laptop.html`):** fifteen parts of a realistic ultrabook, staggered top-down so nothing passes through anything else.
3. **Orrery (`solar.html`):** eight planets and six moons; click a body, fly to it, then carve it open in stair-stepped layers.
4. **Turbofan (`engine.html`):** eleven modules pulled apart along the shaft, with twin-spool spin and a live airflow stream.

## Interaction thesis

- One verb per control: orbit, explode, toggle, inspect. The Explode slider is always the primary gesture.
- Explosion respects physics. Offsets preserve stacking order; parts never intersect on the way out.
- Every part is clickable and answers with a fact, not a tooltip — an inspector chip bottom-left.
- Dark/light is a live re-tint of the 3D scene, not just the chrome.
- Clip planes (x/y/z) and Solid/X-ray/Wireframe are available on every explorer, so the same mental model transfers between them.

## Proportion rules

Units are centimetres and the proportions are real: the laptop is roughly 31.5 x 22 x 1.6 cm closed, with a thin wedge, slim bezels, and low-profile keycaps. Components are individually modelled — separate SSD controller, DRAM and NAND; VRM chokes; EMI shields — rather than represented as blocks. A part that cannot be identified on sight is not finished.

## Accessibility and fallback

- Controls are native inputs (ranges, selects, checkboxes) and remain keyboard reachable.
- The scene is decorative relative to the panel: part names, values and inspector facts are all real DOM text.
- Animation timers run on wall-clock time, so a throttled background tab still completes a teardown rather than stalling mid-way.
- WebGL is required; there is no 2D fallback.

## Do and do not

- Keep the panel frosted, right-aligned, and single-column.
- Keep the accent orange and use it only for state — active toggles, the play button, the current value.
- Preserve the nacelle and core casing as translucent so the turbofan's internals read while assembled.
- Do not close the frosted shells into opaque tubes.
- Do not add marketing copy, tiles, or narrative framing to these pages; the subject and its parts are the whole content.
